import { describe, expect, it } from 'vitest';
import { decomposeDuration, splitAtBoundaries } from './durations';
import { ticksFor } from './ticks';

const PPQ = 480;

describe('decomposeDuration', () => {
  it('returns an empty array for zero ticks', () => {
    expect(decomposeDuration(0, PPQ)).toEqual([]);
  });

  it('returns an empty array for negative ticks', () => {
    expect(decomposeDuration(-100, PPQ)).toEqual([]);
  });

  it('returns a single value when the ticks exactly match one duration', () => {
    expect(decomposeDuration(ticksFor('quarter', PPQ), PPQ)).toEqual([ticksFor('quarter', PPQ)]);
  });

  it('decomposes 7/8 of a whole note into a dotted half plus an eighth (largest-first, greedy)', () => {
    const sevenEighthsOfWhole = Math.round((7 / 8) * ticksFor('whole', PPQ));
    expect(decomposeDuration(sevenEighthsOfWhole, PPQ)).toEqual([
      ticksFor('dotted-half', PPQ),
      ticksFor('eighth', PPQ),
    ]);
  });

  it('decomposes a whole note plus a quarter note as two segments', () => {
    const ticks = ticksFor('whole', PPQ) + ticksFor('quarter', PPQ);
    expect(decomposeDuration(ticks, PPQ)).toEqual([
      ticksFor('whole', PPQ),
      ticksFor('quarter', PPQ),
    ]);
  });

  it('falls back to a non-standard leftover segment when the remainder is smaller than the smallest duration', () => {
    // 960 (half) + 40 leftover ticks, since 40 < thirtysecond note (60 ticks)
    expect(decomposeDuration(1000, PPQ)).toEqual([960, 40]);
  });

  it('always sums back to the original tick length', () => {
    for (const ticks of [1, 40, 100, 480, 1000, 1680, 2400, 5000]) {
      const parts = decomposeDuration(ticks, PPQ);
      expect(parts.reduce((sum, t) => sum + t, 0)).toBe(ticks);
    }
  });

  it('never includes a triplet-only duration in the decomposition', () => {
    // triplet-eighth (160) is not among the greedy candidates, so 160 ticks
    // must decompose via non-triplet durations (dotted-sixteenth 180 doesn't
    // fit; sixteenth 120 + 40 leftover) rather than as a single 160 chunk.
    expect(decomposeDuration(160, PPQ)).toEqual([120, 40]);
  });
});

describe('splitAtBoundaries', () => {
  it('splits a note that crosses a single boundary into two segments', () => {
    expect(splitAtBoundaries(0, 960, [480])).toEqual([
      { startTick: 0, durationTicks: 480 },
      { startTick: 480, durationTicks: 480 },
    ]);
  });

  it('returns the original segment unchanged when no boundary falls inside it', () => {
    expect(splitAtBoundaries(0, 480, [960])).toEqual([{ startTick: 0, durationTicks: 480 }]);
  });

  it('returns the original segment unchanged when there are no boundaries', () => {
    expect(splitAtBoundaries(100, 500, [])).toEqual([{ startTick: 100, durationTicks: 500 }]);
  });

  it('splits a note that crosses multiple boundaries into multiple segments', () => {
    expect(splitAtBoundaries(0, 1920, [480, 960, 1440])).toEqual([
      { startTick: 0, durationTicks: 480 },
      { startTick: 480, durationTicks: 480 },
      { startTick: 960, durationTicks: 480 },
      { startTick: 1440, durationTicks: 480 },
    ]);
  });

  it('does not split when a boundary lands exactly on the start or end tick', () => {
    expect(splitAtBoundaries(480, 480, [480, 960])).toEqual([
      { startTick: 480, durationTicks: 480 },
    ]);
  });

  it('handles unsorted boundaries', () => {
    expect(splitAtBoundaries(0, 1440, [960, 480])).toEqual([
      { startTick: 0, durationTicks: 480 },
      { startTick: 480, durationTicks: 480 },
      { startTick: 960, durationTicks: 480 },
    ]);
  });
});
