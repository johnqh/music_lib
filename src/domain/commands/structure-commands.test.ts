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
  return createEmptyScore({ title: 'S', measures: 2, tracks: [{ name: 'Piano' }] });
}

describe('addMeasureCommand', () => {
  it('appends a fully-rested measure to every track and round-trips through undo', () => {
    const score = baseScore();
    const cmd = addMeasureCommand();

    const next = cmd.execute(score);
    expect(next.tracks[0].measures).toHaveLength(3);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('deleteMeasureCommand', () => {
  it('removes the measure and retracks subsequent measures, round-tripping through undo', () => {
    const score = createEmptyScore({ title: 'S', measures: 3, tracks: [{ name: 'Piano' }] });
    const cmd = deleteMeasureCommand(1);

    const next = cmd.execute(score);
    const track = next.tracks[0];
    expect(track.measures).toHaveLength(2);
    expect(track.measures.map((m) => m.index)).toEqual([0, 1]);
    expect(track.measures[1].startTick).toBe(track.measures[0].durationTicks);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('is a no-op when the measure index does not exist', () => {
    const score = baseScore();
    const cmd = deleteMeasureCommand(99);
    expect(cmd.execute(score)).toEqual(score);
  });
});

describe('addTrackCommand', () => {
  it('adds a track matching the existing measure layout and round-trips through undo', () => {
    const score = baseScore();
    const cmd = addTrackCommand({ name: 'Bass', instrumentName: 'Bass', clef: 'bass' });

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
    const cmd = addTrackCommand({ name: 'Solo' });
    const next = cmd.execute(score);
    expect(next.tracks[0].measures).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('deleteTrackCommand', () => {
  it('removes the track and round-trips through undo', () => {
    const score = createEmptyScore({ title: 'S', tracks: [{ name: 'A' }, { name: 'B' }] });
    const trackId = score.tracks[1].id;
    const cmd = deleteTrackCommand(trackId);

    const next = cmd.execute(score);
    expect(next.tracks.map((t) => t.id)).toEqual([score.tracks[0].id]);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('is a no-op for an unknown track id', () => {
    const score = baseScore();
    const cmd = deleteTrackCommand('missing');
    expect(cmd.execute(score)).toEqual(score);
  });
});

describe('changeTimeSignatureCommand', () => {
  it('changes a measure duration, reflows it, retracks later measures, and round-trips through undo', () => {
    const score = createEmptyScore({ title: 'S', measures: 2, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const measureId = track.measures[0].id;
    const cmd = changeTimeSignatureCommand(measureId, { numerator: 3, denominator: 4 });

    const next = cmd.execute(score);
    const nextTrack = next.tracks[0];
    expect(nextTrack.measures[0].timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(nextTrack.measures[0].durationTicks).toBe(3 * 480);
    expect(nextTrack.measures[1].startTick).toBe(3 * 480);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('is a no-op for an unknown measure id', () => {
    const score = baseScore();
    const cmd = changeTimeSignatureCommand('missing', { numerator: 3, denominator: 4 });
    expect(cmd.execute(score)).toEqual(score);
  });
});

describe('changeKeySignatureCommand', () => {
  it('changes a measure key signature and round-trips through undo', () => {
    const score = baseScore();
    const measureId = score.tracks[0].measures[0].id;
    const cmd = changeKeySignatureCommand(measureId, { fifths: -3, mode: 'minor' });

    const next = cmd.execute(score);
    expect(next.tracks[0].measures[0].keySignature).toEqual({ fifths: -3, mode: 'minor' });
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('changeClefCommand', () => {
  it('changes a track clef and round-trips through undo', () => {
    const score = baseScore();
    const cmd = changeClefCommand(score.tracks[0].id, 'bass');

    const next = cmd.execute(score);
    expect(next.tracks[0].clef).toBe('bass');
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('changeTempoCommand', () => {
  it('inserts a new tempo event and keeps tempoMap sorted, round-tripping through undo', () => {
    const score = baseScore();
    const cmd = changeTempoCommand({ tick: 480, bpm: 140 });

    const next = cmd.execute(score);
    expect(next.tempoMap.map((e) => e.tick)).toEqual([0, 480]);
    expect(next.tempoMap[1].bpm).toBe(140);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('updates an existing tempo event when tempoEventId is given', () => {
    const score = baseScore();
    const existingId = score.tempoMap[0].id;
    const cmd = changeTempoCommand({ tempoEventId: existingId, tick: 0, bpm: 90 });

    const next = cmd.execute(score);
    expect(next.tempoMap).toEqual([{ id: existingId, tick: 0, bpm: 90 }]);
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('changeMetadataCommand', () => {
  it('patches title while preserving createdAt, and round-trips through undo', () => {
    const score = baseScore();
    const cmd = changeMetadataCommand({ title: 'New Title', composer: 'Jane' });

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
    const cmd = changeTrackPropsCommand(trackId, { volume: 0.5, muted: true });

    const next = cmd.execute(score);
    expect(next.tracks[0].volume).toBe(0.5);
    expect(next.tracks[0].muted).toBe(true);
    expect(next.tracks[0].measures).toEqual(score.tracks[0].measures);
    expect(cmd.undo(next)).toEqual(score);
  });
});
