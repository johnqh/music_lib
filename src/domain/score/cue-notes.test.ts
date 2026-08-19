import { describe, expect, it } from 'vitest';
import { createEmptyScore } from './factory.js';
import { addNoteCommand } from '../commands/note-commands.js';
import { applyCues, measureCues } from './cue-notes.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { Pitch, Score } from '@sudobility/music_types';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

/** A score of `bars` bars and `names.length` tracks, every bar of every track sounding once. */
function fullScore(bars: number, names: string[]): Score {
  const base = createEmptyScore({
    title: 'Cues',
    measures: bars,
    tracks: names.map(name => ({
      name,
      instrumentName: name,
      clef: 'treble' as const,
    })),
  });
  return base.tracks.reduce(
    (acc, track) =>
      track.measures.reduce(
        (inner, m) =>
          addNoteCommand(
            {
              trackId: track.id,
              measureId: m.id,
              voiceIndex: 0,
              pitch: pitch('C'),
              startTick: m.startTick,
              durationTicks: base.ppq,
            },
            'Add note'
          ).execute(inner),
        acc
      ),
    base
  );
}

/** `score` with track `trackIndex` silent from bar `from` to bar `to`, inclusive. */
function silence(
  score: Score,
  trackIndex: number,
  from: number,
  to: number
): Score {
  return {
    ...score,
    tracks: score.tracks.map((t, i) =>
      i !== trackIndex
        ? t
        : {
            ...t,
            measures: t.measures.map((m, j) =>
              j >= from && j <= to ? { ...m, voices: [] } : m
            ),
          }
    ),
  };
}

/** `score` with `extra` further notes added to track `trackIndex`'s bar `bar`. */
function thicken(
  score: Score,
  trackIndex: number,
  bar: number,
  extra: number
): Score {
  const track = score.tracks[trackIndex];
  const measure = track.measures[bar];
  let out = score;
  for (let i = 0; i < extra; i += 1) {
    out = addNoteCommand(
      {
        trackId: track.id,
        measureId: measure.id,
        voiceIndex: 0,
        pitch: pitch('E', 5),
        startTick: measure.startTick + (i + 1) * score.ppq,
        durationTicks: score.ppq,
      },
      'Add note'
    ).execute(out);
  }
  return out;
}

describe('measureCues', () => {
  it('cues the bar immediately before an entry after a long rest', () => {
    // Bars 1..20 silent, entry at 21: the cue goes on 20, the last bar of the
    // rest, so the player counts to the cue rather than to the entry.
    const score = silence(fullScore(30, ['A', 'B']), 0, 1, 20);
    const cues = measureCues(score, score.tracks[0].id);
    expect([...cues.keys()]).toEqual([20]);
  });

  it('does not cue a short rest', () => {
    // Four bars: nobody is lost, and the cue would cost a counted bar.
    const score = silence(fullScore(30, ['A', 'B']), 0, 1, 4);
    expect(measureCues(score, score.tracks[0].id).size).toBe(0);
  });

  it('never cues bar 1', () => {
    // A rest from the top still cues — on the bar before the entry, never on
    // the first bar of the piece.
    const score = silence(fullScore(30, ['A', 'B']), 0, 0, 9);
    const cues = measureCues(score, score.tracks[0].id);
    expect(cues.has(0)).toBe(false);
    expect([...cues.keys()]).toEqual([9]);
  });

  it('does not cue a rest that runs to the end', () => {
    // There is no entry to prepare for.
    const score = silence(fullScore(30, ['A', 'B']), 0, 10, 29);
    expect(measureCues(score, score.tracks[0].id).size).toBe(0);
  });

  it('cues the busiest other track', () => {
    // A poor proxy for musical prominence, a good one for audibility — which
    // is what the cued player actually needs.
    const base = silence(fullScore(30, ['A', 'B', 'C']), 0, 1, 20);
    const score = thicken(base, 2, 20, 3);
    const cue = measureCues(score, score.tracks[0].id).get(20);
    expect(cue?.label).toBe('C');
  });

  it('gives no cue when nothing else plays in that bar', () => {
    const base = silence(fullScore(30, ['A', 'B']), 0, 1, 20);
    const score = silence(base, 1, 20, 20);
    expect(measureCues(score, score.tracks[0].id).size).toBe(0);
  });

  it('carries the source bar’s notes', () => {
    const score = silence(fullScore(30, ['A', 'B']), 0, 1, 20);
    const cue = measureCues(score, score.tracks[0].id).get(20);
    expect(cue!.events.filter(isNoteEvent).length).toBeGreaterThan(0);
  });

  it('returns nothing for a track that is not in the score', () => {
    expect(measureCues(fullScore(30, ['A', 'B']), 'nope').size).toBe(0);
  });
});

describe('applyCues', () => {
  it('writes the cue onto the measure at that index', () => {
    const score = fullScore(4, ['A']);
    const cue = { label: 'Flute', events: [] };
    const out = applyCues(score.tracks[0].measures, new Map([[2, cue]]));
    expect(out[2].cue?.label).toBe('Flute');
    expect(out[0].cue).toBeUndefined();
  });

  it('keys by measure index, not array position', () => {
    const score = fullScore(4, ['A']);
    const shifted = score.tracks[0].measures.slice(2);
    const out = applyCues(
      shifted,
      new Map([[2, { label: 'Flute', events: [] }]])
    );
    expect(out[0].cue?.label).toBe('Flute');
  });

  it('does not modify the measures it was given', () => {
    const score = fullScore(4, ['A']);
    const before = JSON.stringify(score.tracks[0].measures);
    applyCues(
      score.tracks[0].measures,
      new Map([[2, { label: 'Flute', events: [] }]])
    );
    expect(JSON.stringify(score.tracks[0].measures)).toBe(before);
  });
});
