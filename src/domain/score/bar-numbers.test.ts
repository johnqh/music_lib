/**
 * Bar numbering with a pickup. The number a bar is *called* has to match the
 * player's part, or "go to bar 33" and the inspector's readout name two
 * different places.
 */
import { describe, expect, it } from 'vitest';
import type { Measure } from '@sudobility/music_types';
import { barNumberAt, hasPickup, indexOfBarNumber } from './bar-numbers.js';

function bars(pickupFirst: boolean, count = 4): Measure[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    index,
    startTick: index * 1920,
    durationTicks: 1920,
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: { fifths: 0, mode: 'major' },
    voices: [],
    ...(pickupFirst && index === 0 ? { pickup: true } : {}),
  })) as Measure[];
}

describe('barNumberAt', () => {
  it('numbers an ordinary score from 1', () => {
    const measures = bars(false);
    expect([0, 1, 2, 3].map(i => barNumberAt(measures, i))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('gives a pickup no number, and makes the next bar bar 1', () => {
    const measures = bars(true);
    expect([0, 1, 2, 3].map(i => barNumberAt(measures, i))).toEqual([
      null,
      1,
      2,
      3,
    ]);
  });

  it('answers null outside the range', () => {
    expect(barNumberAt(bars(false), 9)).toBeNull();
    expect(barNumberAt(bars(false), -1)).toBeNull();
  });
});

describe('indexOfBarNumber', () => {
  it('is the inverse of the numbering, with and without a pickup', () => {
    for (const pickup of [false, true]) {
      const measures = bars(pickup);
      for (let i = 0; i < measures.length; i += 1) {
        const number = barNumberAt(measures, i);
        if (number === null) continue;
        expect(indexOfBarNumber(measures, number)).toBe(i);
      }
    }
  });

  it('finds bar 1 after the pickup, not the pickup itself', () => {
    expect(indexOfBarNumber(bars(true), 1)).toBe(1);
  });

  it('answers null for a bar that does not exist', () => {
    // "Go to bar 500" in a 4-bar score fails rather than landing somewhere.
    expect(indexOfBarNumber(bars(false), 500)).toBeNull();
    expect(indexOfBarNumber(bars(false), 0)).toBeNull();
  });
});

describe('hasPickup', () => {
  it('is true only when the first bar is one', () => {
    expect(hasPickup(bars(true))).toBe(true);
    expect(hasPickup(bars(false))).toBe(false);
    expect(hasPickup([])).toBe(false);
  });
});
