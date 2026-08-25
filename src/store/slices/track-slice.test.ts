import { describe, expect, it } from 'vitest';
import { testStoreContext } from '../../test/store-context.js';
import { twinkleScore, twoTrackScore } from '../../test/fixtures.js';
import { createAppStore } from '../useAppStore.js';
import { pitchToMidi } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import type { Score, Track } from '@sudobility/music_types';

function makeStore(score: Score = twinkleScore()) {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(score);
  return store;
}

function midis(track: Track): number[] {
  return track.measures.flatMap(measure =>
    measure.voices.flatMap(voice =>
      voice.events.filter(isNoteEvent).map(event => pitchToMidi(event.pitch))
    )
  );
}

describe('track-slice', () => {
  it('renames a track, trimming what it is given', () => {
    const store = makeStore();
    const id = store.getState().score!.tracks[0].id;
    store.getState().renameTrack(id, '  Lead  ', 'Rename');
    expect(store.getState().score!.tracks[0].name).toBe('Lead');
  });

  it('refuses a blank name rather than storing one', () => {
    // A track with no name is unreadable in the gutter and in every picker
    // that lists tracks, and there is nothing to fall back to.
    const store = makeStore();
    const track = store.getState().score!.tracks[0];
    store.getState().renameTrack(track.id, '   ', 'Rename');
    expect(store.getState().score!.tracks[0].name).toBe(track.name);
  });

  it('sets the program and the stored name together', () => {
    // `instrumentName` is free text on the track, so the two drift the moment
    // anything sets one without the other.
    const store = makeStore();
    const id = store.getState().score!.tracks[0].id;
    expect(store.getState().setTrackInstrument(id, '40', 'Instrument')).toEqual(
      { ok: true }
    );
    expect(store.getState().score!.tracks[0].midiProgram).toBe(40);
    expect(store.getState().score!.tracks[0].instrumentName).toBe('Violin');
  });

  it('reads a kit value as a kit, not as the program of the same number', () => {
    // Program 40 is Violin *and* the Brush kit. The prefix is the whole
    // distinction, so a value carrying it must never resolve to an instrument.
    const store = makeStore();
    const id = store.getState().score!.tracks[0].id;
    store.getState().setTrackClef(id, 'percussion', 'Clef');
    store.getState().setTrackInstrument(id, 'kit:40', 'Instrument');
    expect(store.getState().score!.tracks[0].instrumentName).toBe('Brush Kit');
  });

  it('carries existing notes into the new instrument compass', () => {
    // Twinkle sits around middle C; a piccolo cannot play that low, so the
    // part moves up by octaves rather than becoming unplayable.
    const store = makeStore();
    const id = store.getState().score!.tracks[0].id;
    const before = midis(store.getState().score!.tracks[0]);
    store.getState().setTrackInstrument(id, '72', 'Instrument');
    const after = midis(store.getState().score!.tracks[0]);

    expect(after.length).toBe(before.length);
    const shift = after[0] - before[0];
    expect(shift).toBeGreaterThan(0);
    // Whole octaves, so the part still reads as the same tune.
    expect(shift % 12).toBe(0);
    expect(after.every((midi, i) => midi - before[i] === shift)).toBe(true);
  });

  it('leaves a part alone when it already fits', () => {
    const store = makeStore();
    const id = store.getState().score!.tracks[0].id;
    const before = midis(store.getState().score!.tracks[0]);
    store.getState().setTrackInstrument(id, '40', 'Instrument');
    expect(midis(store.getState().score!.tracks[0])).toEqual(before);
  });

  it('moves the notes and the instrument as one undo step', () => {
    const store = makeStore();
    const id = store.getState().score!.tracks[0].id;
    const before = midis(store.getState().score!.tracks[0]);
    const program = store.getState().score!.tracks[0].midiProgram;

    store.getState().setTrackInstrument(id, '72', 'Instrument');
    store.getState().undo();

    expect(midis(store.getState().score!.tracks[0])).toEqual(before);
    expect(store.getState().score!.tracks[0].midiProgram).toBe(program);
  });

  it('reports a part too wide for the instrument instead of half-applying it', () => {
    const store = makeStore();
    const id = store.getState().score!.tracks[0].id;
    // Two notes 60 semitones apart span more than any narrow instrument's
    // compass, so no shift can fit them.
    const score = store.getState().score!;
    const wide: Score = {
      ...score,
      tracks: score.tracks.map(track =>
        track.id !== id
          ? track
          : {
              ...track,
              measures: track.measures.map((measure, index) =>
                index !== 0
                  ? measure
                  : {
                      ...measure,
                      voices: measure.voices.map(voice => ({
                        ...voice,
                        events: voice.events.map((event, position) =>
                          isNoteEvent(event) && position === 0
                            ? { ...event, pitch: { ...event.pitch, octave: 0 } }
                            : event
                        ),
                      })),
                    }
              ),
            }
      ),
    };
    store.getState().setScore(wide);

    const result = store.getState().setTrackInstrument(id, '72', 'Instrument');
    expect(result).toEqual({
      ok: false,
      reason: 'outOfRange',
      instrumentName: 'Piccolo',
    });
    expect(store.getState().score!.tracks[0].midiProgram).not.toBe(72);
  });

  it('mixes while the transport plays, where content edits are refused', () => {
    // Muting a part while listening is how an arrangement gets listened to,
    // so mix commands are exempt from the edit lock and renames are not.
    const store = makeStore();
    const track = store.getState().score!.tracks[0];
    store.setState({ state: 'playing' });

    store.getState().setTrackMix(track.id, { muted: true, pan: -0.5 }, 'Mix');
    store.getState().renameTrack(track.id, 'Nope', 'Rename');

    expect(store.getState().score!.tracks[0].muted).toBe(true);
    expect(store.getState().score!.tracks[0].pan).toBe(-0.5);
    expect(store.getState().score!.tracks[0].name).toBe(track.name);
  });

  it('soloing one track clears the solo on another', () => {
    // Two soloed tracks are a state nobody asks for on purpose: you solo to
    // hear one part, and a second solo silently widens what you hear.
    const store = makeStore(twoTrackScore());
    const [first, second] = store.getState().score!.tracks;

    store.getState().setTrackMix(first.id, { solo: true }, 'Solo');
    store.getState().setTrackMix(second.id, { solo: true }, 'Solo');

    expect(store.getState().score!.tracks[0].solo).toBe(false);
    expect(store.getState().score!.tracks[1].solo).toBe(true);
  });

  it('soloing makes that track active, so the others read as silenced', () => {
    // The silence needed a face: an `S` on the soloed track left the rest
    // looking exactly as they always do. Active borrows the dimming that
    // already means "not what you are hearing".
    const store = makeStore(twoTrackScore());
    const [first, second] = store.getState().score!.tracks;
    store.getState().setActiveTrack(first.id);

    store.getState().setTrackMix(second.id, { solo: true }, 'Solo');

    expect(store.getState().activeTrackId).toBe(second.id);
  });

  it('leaves the active track alone when solo is turned off', () => {
    // Clearing a solo is not a request to go anywhere.
    const store = makeStore(twoTrackScore());
    const [first, second] = store.getState().score!.tracks;
    store.getState().setTrackMix(second.id, { solo: true }, 'Solo');
    store.getState().setActiveTrack(first.id);

    store.getState().setTrackMix(second.id, { solo: false }, 'Unsolo');

    expect(store.getState().activeTrackId).toBe(first.id);
  });

  it('muting does not touch solo or the active track', () => {
    const store = makeStore(twoTrackScore());
    const [first, second] = store.getState().score!.tracks;
    store.getState().setTrackMix(first.id, { solo: true }, 'Solo');
    store.getState().setActiveTrack(second.id);

    store.getState().setTrackMix(second.id, { muted: true }, 'Mute');

    expect(store.getState().score!.tracks[0].solo).toBe(true);
    expect(store.getState().activeTrackId).toBe(second.id);
  });

  it('deletes a track when there is more than one', () => {
    const store = makeStore(twoTrackScore());
    const [first, second] = store.getState().score!.tracks;
    expect(store.getState().canDeleteTrack()).toBe(true);
    expect(store.getState().removeTrack(first.id, 'Delete')).toBe(true);
    expect(store.getState().score!.tracks.map(t => t.id)).toEqual([second.id]);
  });

  it('refuses to delete the last track', () => {
    // A score with no tracks renders nothing and has no measure grid to add
    // one back into.
    const store = makeStore();
    const id = store.getState().score!.tracks[0].id;
    expect(store.getState().canDeleteTrack()).toBe(false);
    expect(store.getState().removeTrack(id, 'Delete')).toBe(false);
    expect(store.getState().score!.tracks).toHaveLength(1);
  });

  describe('setScoreMetadata', () => {
    it('sets the title that names exported files', () => {
      // The project name and the score title are different things: renaming a
      // project used to leave exports named after whatever template it began
      // as, because nothing could write this.
      const store = makeStore();
      store.getState().setScoreMetadata({ title: 'Wedding March' }, 'Metadata');
      expect(store.getState().score!.metadata.title).toBe('Wedding March');
    });

    it('sets a composer, which had no path at all before', () => {
      const store = makeStore();
      store.getState().setScoreMetadata({ composer: 'J. Huang' }, 'Metadata');
      expect(store.getState().score!.metadata.composer).toBe('J. Huang');
    });

    it('trims what it is given', () => {
      const store = makeStore();
      store.getState().setScoreMetadata({ title: '  Nocturne  ' }, 'Metadata');
      expect(store.getState().score!.metadata.title).toBe('Nocturne');
    });

    it('refuses a blank title, which everything downstream uses as a filename', () => {
      const store = makeStore();
      const before = store.getState().score!.metadata.title;
      store.getState().setScoreMetadata({ title: '   ' }, 'Metadata');
      expect(store.getState().score!.metadata.title).toBe(before);
    });

    it('leaves the fields it was not given alone', () => {
      const store = makeStore();
      store.getState().setScoreMetadata({ composer: 'Trad.' }, 'Metadata');
      const title = store.getState().score!.metadata.title;
      store.getState().setScoreMetadata({ title: 'Air' }, 'Metadata');
      expect(store.getState().score!.metadata.composer).toBe('Trad.');
      expect(store.getState().score!.metadata.title).toBe('Air');
      expect(title).toBeTruthy();
    });

    it('is undoable, like any other score change', () => {
      const store = makeStore();
      const before = store.getState().score!.metadata.title;
      store.getState().setScoreMetadata({ title: 'Changed' }, 'Metadata');
      store.getState().undo();
      expect(store.getState().score!.metadata.title).toBe(before);
    });
  });
});
