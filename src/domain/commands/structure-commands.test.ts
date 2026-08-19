import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import { validateScore } from '../validation/validator.js';
import {
  addMeasureCommand,
  addTrackCommand,
  changeClefCommand,
  changeKeySignatureCommand,
  changeMetadataCommand,
  changeTempoCommand,
  changeTimeSignatureCommand,
  changeTrackPropsCommand,
  deleteMeasureCommand,
  deleteTrackCommand,
} from './structure-commands.js';

function baseScore() {
  return createEmptyScore({
    title: 'S',
    measures: 2,
    tracks: [{ name: 'Piano' }],
  });
}

describe('addMeasureCommand', () => {
  it('appends a fully-rested measure to every track and round-trips through undo', () => {
    const score = baseScore();
    const cmd = addMeasureCommand('Add measure');

    const next = cmd.execute(score);
    expect(next.tracks[0].measures).toHaveLength(3);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('deleteMeasureCommand', () => {
  it('removes the measure and retracks subsequent measures, round-tripping through undo', () => {
    const score = createEmptyScore({
      title: 'S',
      measures: 3,
      tracks: [{ name: 'Piano' }],
    });
    const cmd = deleteMeasureCommand(1, 'Delete measure');

    const next = cmd.execute(score);
    const track = next.tracks[0];
    expect(track.measures).toHaveLength(2);
    expect(track.measures.map(m => m.index)).toEqual([0, 1]);
    expect(track.measures[1].startTick).toBe(track.measures[0].durationTicks);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('is a no-op when the measure index does not exist', () => {
    const score = baseScore();
    const cmd = deleteMeasureCommand(99, 'Delete measure');
    expect(cmd.execute(score)).toEqual(score);
  });
});

describe('addTrackCommand', () => {
  it('adds a track matching the existing measure layout and round-trips through undo', () => {
    const score = baseScore();
    const cmd = addTrackCommand(
      {
        name: 'Bass',
        instrumentName: 'Bass',
        clef: 'bass',
      },
      'Add track'
    );

    const next = cmd.execute(score);
    expect(next.tracks).toHaveLength(2);
    const added = next.tracks[1];
    expect(added.name).toBe('Bass');
    expect(added.measures).toHaveLength(score.tracks[0].measures.length);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('adds an empty (no-measures) track to a score with no existing tracks', () => {
    const score = createEmptyScore({ title: 'S', tracks: [] });
    const cmd = addTrackCommand({ name: 'Solo' }, 'Add track');
    const next = cmd.execute(score);
    expect(next.tracks[0].measures).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('deleteTrackCommand', () => {
  it('removes the track and round-trips through undo', () => {
    const score = createEmptyScore({
      title: 'S',
      tracks: [{ name: 'A' }, { name: 'B' }],
    });
    const trackId = score.tracks[1].id;
    const cmd = deleteTrackCommand(trackId, 'Delete track');

    const next = cmd.execute(score);
    expect(next.tracks.map(t => t.id)).toEqual([score.tracks[0].id]);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('is a no-op for an unknown track id', () => {
    const score = baseScore();
    const cmd = deleteTrackCommand('missing', 'Delete track');
    expect(cmd.execute(score)).toEqual(score);
  });
});

describe('changeTimeSignatureCommand', () => {
  it('changes a measure duration, reflows it, retracks later measures, and round-trips through undo', () => {
    const score = createEmptyScore({
      title: 'S',
      measures: 2,
      tracks: [{ name: 'Piano' }],
    });
    const track = score.tracks[0];
    const measureId = track.measures[0].id;
    const cmd = changeTimeSignatureCommand(
      measureId,
      {
        numerator: 3,
        denominator: 4,
      },
      'Change time signature'
    );

    const next = cmd.execute(score);
    const nextTrack = next.tracks[0];
    expect(nextTrack.measures[0].timeSignature).toEqual({
      numerator: 3,
      denominator: 4,
    });
    expect(nextTrack.measures[0].durationTicks).toBe(3 * 480);
    expect(nextTrack.measures[1].startTick).toBe(3 * 480);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('is a no-op for an unknown measure id', () => {
    const score = baseScore();
    const cmd = changeTimeSignatureCommand(
      'missing',
      {
        numerator: 3,
        denominator: 4,
      },
      'Change time signature'
    );
    expect(cmd.execute(score)).toEqual(score);
  });
});

describe('changeKeySignatureCommand', () => {
  it('changes a measure key signature and round-trips through undo', () => {
    const score = baseScore();
    const measureId = score.tracks[0].measures[0].id;
    const cmd = changeKeySignatureCommand(
      measureId,
      {
        fifths: -3,
        mode: 'minor',
      },
      'Change key signature'
    );

    const next = cmd.execute(score);
    expect(next.tracks[0].measures[0].keySignature).toEqual({
      fifths: -3,
      mode: 'minor',
    });
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('changeClefCommand', () => {
  it('changes a track clef and round-trips through undo', () => {
    const score = baseScore();
    const cmd = changeClefCommand(score.tracks[0].id, 'bass', 'Change clef');

    const next = cmd.execute(score);
    expect(next.tracks[0].clef).toBe('bass');
    expect(cmd.undo(next)).toEqual(score);
  });

  it('reinterprets the program when a track becomes percussion', () => {
    // `midiProgram` addresses a kit on a percussion track, so the number the
    // track already holds now means something else. Program 40 is Violin as an
    // instrument and Brush as an address.
    const score = baseScore();
    const track = {
      ...score.tracks[0],
      midiProgram: 40,
      instrumentName: 'Violin',
    };
    const withViolin = { ...score, tracks: [track, ...score.tracks.slice(1)] };

    const next = changeClefCommand(
      track.id,
      'percussion',
      'Change clef'
    ).execute(withViolin);
    expect(next.tracks[0].midiProgram).toBe(40);
    expect(next.tracks[0].instrumentName).toBe('Brush Kit');
  });

  it('resets the program when a track stops being percussion', () => {
    // A kit address as an instrument is whatever program happens to sit there,
    // which is not a choice anybody made.
    const score = baseScore();
    const track = {
      ...score.tracks[0],
      clef: 'percussion' as const,
      midiProgram: 40,
      instrumentName: 'Brush Kit',
    };
    const withKit = { ...score, tracks: [track, ...score.tracks.slice(1)] };

    const next = changeClefCommand(track.id, 'treble', 'Change clef').execute(
      withKit
    );
    expect(next.tracks[0].midiProgram).toBe(0);
    expect(next.tracks[0].instrumentName).toBe('Acoustic Grand Piano');
  });

  it('leaves the program alone when the clef change stays on one side', () => {
    const score = baseScore();
    const track = {
      ...score.tracks[0],
      midiProgram: 40,
      instrumentName: 'Violin',
    };
    const withViolin = { ...score, tracks: [track, ...score.tracks.slice(1)] };

    const next = changeClefCommand(track.id, 'bass', 'Change clef').execute(
      withViolin
    );
    expect(next.tracks[0].midiProgram).toBe(40);
    expect(next.tracks[0].instrumentName).toBe('Violin');
  });

  it('keeps the user’s own track name across the reinterpretation', () => {
    // `name` is theirs; `instrumentName` describes the sound and has to follow.
    const score = baseScore();
    const track = { ...score.tracks[0], name: 'Backbeat', midiProgram: 40 };
    const withName = { ...score, tracks: [track, ...score.tracks.slice(1)] };

    const next = changeClefCommand(
      track.id,
      'percussion',
      'Change clef'
    ).execute(withName);
    expect(next.tracks[0].name).toBe('Backbeat');
  });
});

describe('changeTempoCommand', () => {
  it('inserts a new tempo event and keeps tempoMap sorted, round-tripping through undo', () => {
    const score = baseScore();
    const cmd = changeTempoCommand({ tick: 480, bpm: 140 }, 'Change tempo');

    const next = cmd.execute(score);
    expect(next.tempoMap.map(e => e.tick)).toEqual([0, 480]);
    expect(next.tempoMap[1].bpm).toBe(140);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('updates an existing tempo event when tempoEventId is given', () => {
    const score = baseScore();
    const existingId = score.tempoMap[0].id;
    const cmd = changeTempoCommand(
      {
        tempoEventId: existingId,
        tick: 0,
        bpm: 90,
      },
      'Change tempo'
    );

    const next = cmd.execute(score);
    expect(next.tempoMap).toEqual([{ id: existingId, tick: 0, bpm: 90 }]);
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('changeMetadataCommand', () => {
  it('patches title while preserving createdAt, and round-trips through undo', () => {
    const score = baseScore();
    const cmd = changeMetadataCommand(
      { title: 'New Title', composer: 'Jane' },
      'Change metadata'
    );

    const next = cmd.execute(score);
    expect(next.metadata.title).toBe('New Title');
    expect(next.metadata.composer).toBe('Jane');
    expect(next.metadata.createdAt).toBe(score.metadata.createdAt);
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('changeTrackPropsCommand', () => {
  it('patches non-structural track properties and round-trips through undo', () => {
    const score = baseScore();
    const trackId = score.tracks[0].id;
    const cmd = changeTrackPropsCommand(
      trackId,
      { volume: 0.5, muted: true },
      'Change track properties'
    );

    const next = cmd.execute(score);
    expect(next.tracks[0].volume).toBe(0.5);
    expect(next.tracks[0].muted).toBe(true);
    expect(next.tracks[0].measures).toEqual(score.tracks[0].measures);
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('command kind', () => {
  it('classifies a patch of only mix properties as mix', () => {
    expect(
      changeTrackPropsCommand('t1', { muted: true }, 'Change track properties')
        .kind
    ).toBe('mix');
    expect(
      changeTrackPropsCommand('t1', { solo: true }, 'Change track properties')
        .kind
    ).toBe('mix');
    expect(
      changeTrackPropsCommand('t1', { volume: 0.5 }, 'Change track properties')
        .kind
    ).toBe('mix');
    expect(
      changeTrackPropsCommand('t1', { pan: -1 }, 'Change track properties').kind
    ).toBe('mix');
    expect(
      changeTrackPropsCommand(
        't1',
        { volume: 0.5, muted: true },
        'Change track properties'
      ).kind
    ).toBe('mix');
  });

  it('classifies anything touching the score as content', () => {
    expect(
      changeTrackPropsCommand(
        't1',
        { name: 'Viola' },
        'Change track properties'
      ).kind
    ).toBe('content');
    expect(
      changeTrackPropsCommand(
        't1',
        { midiProgram: 41 },
        'Change track properties'
      ).kind
    ).toBe('content');
    expect(
      changeTrackPropsCommand('t1', { clef: 'bass' }, 'Change track properties')
        .kind
    ).toBe('content');
  });

  it('classifies a mixed patch as content, because half of it is', () => {
    expect(
      changeTrackPropsCommand(
        't1',
        { muted: true, name: 'Viola' },
        'Change track properties'
      ).kind
    ).toBe('content');
  });

  it('treats an empty patch as mix, since it changes nothing', () => {
    expect(
      changeTrackPropsCommand('t1', {}, 'Change track properties').kind
    ).toBe('mix');
  });

  it('defaults every other command to content', () => {
    expect(addTrackCommand({ name: 'New' }, 'Add track').kind).toBe('content');
  });
});
