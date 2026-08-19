import { describe, expect, it } from 'vitest';
import type { NoteEvent, Score, ScoreSelection } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { twoTrackScore } from '../../test/fixtures.js';
import { replacementRegion } from './replacement-region.js';

/** Notes of one track, in tick order — the fixture's treble track is four quarters per measure. */
function notesOfTrack(score: Score, trackIndex: number): NoteEvent[] {
  const track = score.tracks[trackIndex];
  return track.measures
    .flatMap(m => m.voices.flatMap(v => v.events))
    .filter((e): e is NoteEvent => isNoteEvent(e))
    .sort((a, b) => a.startTick - b.startTick);
}

const emptySelection = (): ScoreSelection => ({
  eventIds: [],
  measureIds: [],
  trackIds: [],
});

describe('replacementRegion — notes', () => {
  it('spans exactly the selected notes, without snapping to the measure', () => {
    const score = twoTrackScore();
    const notes = notesOfTrack(score, 0);
    const selection: ScoreSelection = {
      eventIds: [notes[1].id, notes[2].id],
      measureIds: [],
      trackIds: [],
    };

    const region = replacementRegion(score, selection, null, 'notes');

    expect(region).not.toBeNull();
    expect(region!.range.startTick).toBe(notes[1].startTick);
    expect(region!.range.endTick).toBe(
      notes[2].startTick + notes[2].durationTicks
    );
    // The whole point: beats 2-3 of measure 1, not the measure.
    expect(region!.range.startTick).not.toBe(0);
    expect(region!.measureAligned).toBe(false);
    expect(region!.range.trackIds).toEqual([score.tracks[0].id]);
  });

  it('covers the gap in a non-contiguous selection and reports the notes it will take', () => {
    const score = twoTrackScore();
    const notes = notesOfTrack(score, 0);
    // Beats 1 and 4 of measure 1; beats 2 and 3 are unselected but inside.
    const selection: ScoreSelection = {
      eventIds: [notes[0].id, notes[3].id],
      measureIds: [],
      trackIds: [],
    };

    const region = replacementRegion(score, selection, null, 'notes')!;

    expect(region.range.startTick).toBe(notes[0].startTick);
    expect(region.range.endTick).toBe(
      notes[3].startTick + notes[3].durationTicks
    );
    expect(region.noteCount).toBe(4);
    expect(region.unselectedNoteCount).toBe(2);
  });

  it('reports no unselected notes for a contiguous run', () => {
    const score = twoTrackScore();
    const notes = notesOfTrack(score, 0);
    const selection: ScoreSelection = {
      eventIds: [notes[0].id, notes[1].id],
      measureIds: [],
      trackIds: [],
    };

    const region = replacementRegion(score, selection, null, 'notes')!;

    expect(region.noteCount).toBe(2);
    expect(region.unselectedNoteCount).toBe(0);
  });

  it('covers every track the selected notes live on', () => {
    const score = twoTrackScore();
    const a = notesOfTrack(score, 0)[0];
    const b = notesOfTrack(score, 1)[0];
    const selection: ScoreSelection = {
      eventIds: [a.id, b.id],
      measureIds: [],
      trackIds: [],
    };

    const region = replacementRegion(score, selection, null, 'notes')!;

    expect([...region.range.trackIds].sort()).toEqual(
      [score.tracks[0].id, score.tracks[1].id].sort()
    );
  });

  it('is null with no notes selected', () => {
    expect(
      replacementRegion(twoTrackScore(), emptySelection(), null, 'notes')
    ).toBeNull();
  });
});

describe('replacementRegion — measures', () => {
  it('spans the selected measures and is measure-aligned', () => {
    const score = twoTrackScore();
    const m = score.tracks[0].measures;
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [m[1].id, m[2].id],
      trackIds: [],
    };

    const region = replacementRegion(score, selection, null, 'measures')!;

    expect(region.range.startTick).toBe(m[1].startTick);
    expect(region.range.endTick).toBe(m[2].startTick + m[2].durationTicks);
    expect(region.measureAligned).toBe(true);
  });

  it('takes its tracks from the selected measure ids, so a cross-track selection covers both', () => {
    const score = twoTrackScore();
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [
        score.tracks[0].measures[0].id,
        score.tracks[1].measures[0].id,
      ],
      trackIds: [],
    };

    const region = replacementRegion(score, selection, null, 'measures')!;

    expect([...region.range.trackIds].sort()).toEqual(
      [score.tracks[0].id, score.tracks[1].id].sort()
    );
  });

  it('covers one track only when only that track’s measure is selected', () => {
    const score = twoTrackScore();
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [score.tracks[1].measures[0].id],
      trackIds: [],
    };

    const region = replacementRegion(score, selection, null, 'measures')!;

    expect(region.range.trackIds).toEqual([score.tracks[1].id]);
  });

  it('reports every note in range as unselected, since measures select no notes', () => {
    const score = twoTrackScore();
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [score.tracks[0].measures[0].id],
      trackIds: [],
    };

    const region = replacementRegion(score, selection, null, 'measures')!;

    expect(region.noteCount).toBe(4);
    expect(region.unselectedNoteCount).toBe(region.noteCount);
  });

  it('is null with no measures selected', () => {
    expect(
      replacementRegion(twoTrackScore(), emptySelection(), null, 'measures')
    ).toBeNull();
  });
});

describe('replacementRegion — track', () => {
  it('spans the whole score on the active track alone', () => {
    const score = twoTrackScore();

    const region = replacementRegion(
      score,
      emptySelection(),
      score.tracks[1].id,
      'track'
    )!;

    expect(region.range.startTick).toBe(0);
    const last = score.tracks[1].measures.at(-1)!;
    expect(region.range.endTick).toBe(last.startTick + last.durationTicks);
    expect(region.range.trackIds).toEqual([score.tracks[1].id]);
    expect(region.measureAligned).toBe(true);
  });

  it('ignores the selection entirely', () => {
    const score = twoTrackScore();
    const notes = notesOfTrack(score, 0);
    const withSelection: ScoreSelection = {
      eventIds: [notes[0].id],
      measureIds: [],
      trackIds: [],
    };

    const a = replacementRegion(
      score,
      withSelection,
      score.tracks[0].id,
      'track'
    );
    const b = replacementRegion(
      score,
      emptySelection(),
      score.tracks[0].id,
      'track'
    );

    expect(a).toEqual(b);
  });

  it('is null when there is no active track', () => {
    expect(
      replacementRegion(twoTrackScore(), emptySelection(), null, 'track')
    ).toBeNull();
  });

  it('is null when the active track id is stale', () => {
    expect(
      replacementRegion(twoTrackScore(), emptySelection(), 'gone', 'track')
    ).toBeNull();
  });
});
