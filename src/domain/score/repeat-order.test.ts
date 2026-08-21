import { describe, expect, it } from 'vitest';
import type { Measure, Score } from '@sudobility/music_types';
import { repeatPlayOrder } from './repeat-order.js';

/** A score of `count` bars, with per-bar repeat markings applied by index. */
function scoreWith(
  count: number,
  markings: Record<number, Partial<Measure>> = {}
): Score {
  return {
    id: 's',
    version: 1,
    ppq: 480,
    metadata: { title: 'T', createdAt: '', updatedAt: '' },
    tempoMap: [{ id: 't', tick: 0, bpm: 120 }],
    tracks: [
      {
        id: 'tr',
        measures: Array.from({ length: count }, (_, index) => ({
          id: `m${index}`,
          index,
          startTick: index * 1920,
          durationTicks: 1920,
          timeSignature: { numerator: 4, denominator: 4 },
          keySignature: { fifths: 0, mode: 'major' },
          voices: [],
          ...(markings[index] ?? {}),
        })),
      },
    ],
  } as unknown as Score;
}

/** Just the bar numbers played, for readable assertions. */
function played(score: Score): number[] {
  return repeatPlayOrder(score).map(p => p.measureIndex);
}

describe('repeatPlayOrder', () => {
  it('plays an unrepeated score straight through, once', () => {
    // The safety property: playback of a score without repeats is exactly
    // what it was before repeats existed.
    expect(played(scoreWith(4))).toEqual([0, 1, 2, 3]);
  });

  it('repeats a marked section once', () => {
    const score = scoreWith(4, {
      0: { repeatStart: true },
      1: { repeatEnd: true },
    });
    expect(played(score)).toEqual([0, 1, 0, 1, 2, 3]);
  });

  it('repeats from the start when there is no opening mark', () => {
    // A `:|` alone means "repeat from the beginning", which is a real
    // marking rather than an error.
    const score = scoreWith(3, { 1: { repeatEnd: true } });
    expect(played(score)).toEqual([0, 1, 0, 1, 2]);
  });

  it('takes a first ending only on the first pass, and a second only on the second', () => {
    const score = scoreWith(5, {
      0: { repeatStart: true },
      2: { endingNumbers: [1], repeatEnd: true },
      3: { endingNumbers: [2] },
    });
    // Pass 1: 0 1 2 (first ending), back. Pass 2: 0 1 (skip first ending) 3 4.
    expect(played(score)).toEqual([0, 1, 2, 0, 1, 3, 4]);
  });

  it('plays a bar marked for both passes on both', () => {
    const score = scoreWith(4, {
      0: { repeatStart: true },
      2: { endingNumbers: [1, 2], repeatEnd: true },
    });
    expect(played(score)).toEqual([0, 1, 2, 0, 1, 2, 3]);
  });

  it('records which pass each bar belongs to', () => {
    const score = scoreWith(3, {
      0: { repeatStart: true },
      1: { repeatEnd: true },
    });
    expect(repeatPlayOrder(score).map(p => p.pass)).toEqual([1, 1, 2, 2, 2]);
  });

  it('handles two separate repeated sections', () => {
    const score = scoreWith(6, {
      0: { repeatStart: true },
      1: { repeatEnd: true },
      3: { repeatStart: true },
      4: { repeatEnd: true },
    });
    expect(played(score)).toEqual([0, 1, 0, 1, 2, 3, 4, 3, 4, 5]);
  });

  it('terminates on a malformed score rather than looping forever', () => {
    // A bad import must not hang the editor.
    const score = scoreWith(3, {
      0: { repeatStart: true },
      1: { repeatEnd: true, repeatStart: true },
      2: { repeatEnd: true },
    });
    const order = played(score);
    expect(order.length).toBeGreaterThan(0);
    expect(order.length).toBeLessThanOrEqual(3 * 10);
  });

  it('is empty for a score with no bars', () => {
    expect(played(scoreWith(0))).toEqual([]);
  });
});
