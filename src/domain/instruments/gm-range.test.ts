import { describe, expect, it } from 'vitest';
import { GM_INSTRUMENTS } from './gm.js';
import { FULL_KEYBOARD, gmInstrumentRange } from './gm-range.js';

describe('gmInstrumentRange', () => {
  it('gives every one of the 128 programs a usable range', () => {
    for (const instrument of GM_INSTRUMENTS) {
      const { min, max } = gmInstrumentRange(instrument.program);
      expect(min, instrument.name).toBeGreaterThanOrEqual(FULL_KEYBOARD.min);
      expect(max, instrument.name).toBeLessThanOrEqual(FULL_KEYBOARD.max);
      // An octave is the least that is worth drawing a keyboard for.
      expect(max - min, instrument.name).toBeGreaterThanOrEqual(12);
    }
  });

  it('separates instruments the family default would get badly wrong', () => {
    // Both are "pipe"; showing them the same keyboard would say nothing about
    // what will actually sound.
    const piccolo = gmInstrumentRange(72);
    const tuba = gmInstrumentRange(58);
    expect(piccolo.min).toBeGreaterThan(tuba.max);
  });

  it('places the usual suspects where a player would expect', () => {
    expect(gmInstrumentRange(40)).toEqual({ min: 55, max: 100 }); // Violin, G3 up
    expect(gmInstrumentRange(42).min).toBe(36); // Cello, C2
    expect(gmInstrumentRange(0)).toEqual(FULL_KEYBOARD); // Piano, all 88
  });

  it('falls back to its family when a program has no override', () => {
    // Program 1 (Bright Acoustic Piano) has no entry of its own.
    expect(gmInstrumentRange(1)).toEqual(gmInstrumentRange(2));
  });

  it('falls back to the full keyboard outside the range rather than guessing', () => {
    expect(gmInstrumentRange(-1)).toEqual(FULL_KEYBOARD);
    expect(gmInstrumentRange(999)).toEqual(FULL_KEYBOARD);
  });

  it('never returns an inverted range', () => {
    for (const instrument of GM_INSTRUMENTS) {
      const { min, max } = gmInstrumentRange(instrument.program);
      expect(min, instrument.name).toBeLessThan(max);
    }
  });
});
