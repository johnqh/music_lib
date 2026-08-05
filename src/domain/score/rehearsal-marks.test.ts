import { describe, expect, it } from 'vitest';
import { createEmptyScore } from './factory.js';
import { addNoteCommand } from '../commands/note-commands.js';
import {
  applyRehearsalMarks,
  markLabel,
  rehearsalMarks,
  withRehearsalMarks,
} from './rehearsal-marks.js';
import type { KeySignature, Pitch, Score, TimeSignature } from '@sudobility/music_types';

const pitch = (step: string): Pitch =>
  ({ step, accidental: 0, octave: 4 }) as unknown as Pitch;

/** A one-track score of `measures` bars, every bar sounding. */
function fullScore(measures: number): Score {
  const base = createEmptyScore({
    title: 'Marks',
    measures,
    tracks: [{ name: 'A', instrumentName: 'Piano', clef: 'treble' as const }],
  });
  const track = base.tracks[0];
  return track.measures.reduce(
    (acc, m) =>
      addNoteCommand({
        trackId: track.id,
        measureId: m.id,
        voiceIndex: 0,
        pitch: pitch('C'),
        startTick: m.startTick,
        durationTicks: base.ppq,
      }).execute(acc),
    base,
  );
}

/** `score` with `patch` applied to the measures at `indices` on every track. */
function patchMeasures(score: Score, indices: number[], patch: Partial<Score['tracks'][0]['measures'][0]>): Score {
  return {
    ...score,
    tracks: score.tracks.map((t) => ({
      ...t,
      measures: t.measures.map((m, i) => (indices.includes(i) ? { ...m, ...patch } : m)),
    })),
  };
}

describe('markLabel', () => {
  it('runs A to Z', () => {
    expect(markLabel(0)).toBe('A');
    expect(markLabel(25)).toBe('Z');
  });

  it('doubles the letter after Z, rather than pairing two', () => {
    // "AB" spoken over a bad line sounds like two separate marks.
    expect(markLabel(26)).toBe('AA');
    expect(markLabel(27)).toBe('BB');
    expect(markLabel(51)).toBe('ZZ');
  });

  it('triples after that', () => {
    expect(markLabel(52)).toBe('AAA');
  });
});

describe('rehearsalMarks', () => {
  it('never marks the first bar', () => {
    // "From the top" already exists and needs no letter.
    expect(rehearsalMarks(fullScore(40)).has(0)).toBe(false);
  });

  it('marks every 16 bars through an unbroken stretch', () => {
    const marks = rehearsalMarks(fullScore(40));
    expect([...marks.keys()].sort((a, b) => a - b)).toEqual([16, 32]);
  });

  it('marks a time-signature change', () => {
    const threeFour: TimeSignature = { numerator: 3, denominator: 4 };
    const score = patchMeasures(fullScore(12), [5], { timeSignature: threeFour });
    expect(rehearsalMarks(score).has(5)).toBe(true);
  });

  it('marks a key change', () => {
    const dMajor: KeySignature = { fifths: 2, mode: 'major' };
    const score = patchMeasures(fullScore(12), [7], { keySignature: dMajor });
    expect(rehearsalMarks(score).has(7)).toBe(true);
  });

  it('marks the bar after a long silence, where somebody re-enters', () => {
    // The moment a conductor restarts from, and the moment a lost player most
    // needs a landmark.
    const score = patchMeasures(fullScore(12), [4, 5, 6], { voices: [] });
    expect(rehearsalMarks(score).has(7)).toBe(true);
  });

  it('does not mark after a single silent bar', () => {
    const score = patchMeasures(fullScore(12), [4], { voices: [] });
    expect(rehearsalMarks(score).has(5)).toBe(false);
  });

  it('keeps marks at least four bars apart, earlier winning', () => {
    // Two metre changes three bars apart must not produce two marks: three
    // marks in a row help nobody.
    const threeFour: TimeSignature = { numerator: 3, denominator: 4 };
    const twoFour: TimeSignature = { numerator: 2, denominator: 4 };
    const score = patchMeasures(
      patchMeasures(fullScore(20), [5], { timeSignature: threeFour }),
      [7],
      { timeSignature: twoFour },
    );
    const marks = rehearsalMarks(score);
    expect(marks.has(5)).toBe(true);
    expect(marks.has(7)).toBe(false);
  });

  it('letters them in bar order', () => {
    const threeFour: TimeSignature = { numerator: 3, denominator: 4 };
    const score = patchMeasures(fullScore(40), [5], { timeSignature: threeFour });
    const marks = rehearsalMarks(score);
    const inOrder = [...marks.entries()].sort((a, b) => a[0] - b[0]).map(([, label]) => label);
    expect(inOrder).toEqual(inOrder.map((_, i) => markLabel(i)));
  });

  it('sees silence in any track, not just the first', () => {
    // A mark is a landmark for everybody; the second oboe re-entering is as
    // structural as the first violin doing so.
    const base = fullScore(12);
    const twoTrack: Score = {
      ...base,
      tracks: [base.tracks[0], { ...base.tracks[0], id: 't2', name: 'B' }],
    };
    const silenced: Score = {
      ...twoTrack,
      tracks: twoTrack.tracks.map((t, i) =>
        i === 1
          ? { ...t, measures: t.measures.map((m, j) => (j >= 4 && j <= 6 ? { ...m, voices: [] } : m)) }
          : t,
      ),
    };
    expect(rehearsalMarks(silenced).has(7)).toBe(true);
  });
});

describe('applyRehearsalMarks', () => {
  it('writes the mark onto the measure at that index', () => {
    const score = fullScore(4);
    const marked = applyRehearsalMarks(score.tracks[0].measures, new Map([[2, 'B']]));
    expect(marked[2].rehearsalMark).toBe('B');
    expect(marked[0].rehearsalMark).toBeUndefined();
  });

  it('keys by measure index, not array position', () => {
    // A part's measures are already renumbered by collapsing in feature 3, so
    // position is not a reliable key.
    const score = fullScore(4);
    const shifted = score.tracks[0].measures.slice(2); // starts at index 2
    const marked = applyRehearsalMarks(shifted, new Map([[2, 'B']]));
    expect(marked[0].rehearsalMark).toBe('B');
  });

  it('does not modify the measures it was given', () => {
    const score = fullScore(4);
    const before = JSON.stringify(score.tracks[0].measures);
    applyRehearsalMarks(score.tracks[0].measures, new Map([[2, 'B']]));
    expect(JSON.stringify(score.tracks[0].measures)).toBe(before);
  });
});

describe('withRehearsalMarks', () => {
  it('marks every track identically', () => {
    // The whole point: "from B" must mean one bar for everyone.
    const base = fullScore(40);
    const twoTrack: Score = {
      ...base,
      tracks: [base.tracks[0], { ...base.tracks[0], id: 't2', name: 'B' }],
    };
    const marked = withRehearsalMarks(twoTrack);
    const labels = (trackIndex: number) =>
      marked.tracks[trackIndex].measures
        .map((m, i) => [i, m.rehearsalMark] as const)
        .filter(([, label]) => label !== undefined);
    expect(labels(0)).toEqual(labels(1));
    expect(labels(0).length).toBeGreaterThan(0);
  });
});
