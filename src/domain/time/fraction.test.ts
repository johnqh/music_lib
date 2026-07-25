import { describe, expect, it } from 'vitest';
import {
  addFractions,
  compareFractions,
  fraction,
  fractionToTicks,
  normalizeFraction,
  subtractFractions,
} from './fraction';

describe('fraction', () => {
  it('constructs a fraction from numerator and denominator', () => {
    expect(fraction(1, 4)).toEqual({ numerator: 1, denominator: 4 });
  });
});

describe('normalizeFraction', () => {
  it('reduces to lowest terms', () => {
    expect(normalizeFraction({ numerator: 2, denominator: 4 })).toEqual({
      numerator: 1,
      denominator: 2,
    });
  });

  it('keeps an already-reduced fraction unchanged', () => {
    expect(normalizeFraction({ numerator: 3, denominator: 8 })).toEqual({
      numerator: 3,
      denominator: 8,
    });
  });

  it('moves a negative sign from the denominator to the numerator', () => {
    expect(normalizeFraction({ numerator: 2, denominator: -4 })).toEqual({
      numerator: -1,
      denominator: 2,
    });
  });

  it('cancels double negatives to a positive fraction', () => {
    expect(normalizeFraction({ numerator: -2, denominator: -4 })).toEqual({
      numerator: 1,
      denominator: 2,
    });
  });

  it('keeps a negative numerator with a positive denominator negative', () => {
    expect(normalizeFraction({ numerator: -1, denominator: 4 })).toEqual({
      numerator: -1,
      denominator: 4,
    });
  });

  it('normalizes zero to 0/1 regardless of denominator', () => {
    expect(normalizeFraction({ numerator: 0, denominator: 5 })).toEqual({
      numerator: 0,
      denominator: 1,
    });
  });

  it('throws on a zero denominator', () => {
    expect(() => normalizeFraction({ numerator: 1, denominator: 0 })).toThrow();
  });
});

describe('addFractions', () => {
  it('adds fractions with the same denominator', () => {
    expect(addFractions(fraction(1, 4), fraction(1, 4))).toEqual({
      numerator: 1,
      denominator: 2,
    });
  });

  it('adds fractions with different denominators', () => {
    expect(addFractions(fraction(1, 3), fraction(1, 6))).toEqual({
      numerator: 1,
      denominator: 2,
    });
  });

  it('adds a negative fraction correctly', () => {
    expect(addFractions(fraction(1, 4), fraction(-1, 4))).toEqual({
      numerator: 0,
      denominator: 1,
    });
  });
});

describe('subtractFractions', () => {
  it('subtracts fractions producing a positive result', () => {
    expect(subtractFractions(fraction(1, 2), fraction(1, 4))).toEqual({
      numerator: 1,
      denominator: 4,
    });
  });

  it('subtracts fractions producing a negative result', () => {
    expect(subtractFractions(fraction(1, 4), fraction(1, 2))).toEqual({
      numerator: -1,
      denominator: 4,
    });
  });
});

describe('compareFractions', () => {
  it('returns -1 when the first fraction is smaller', () => {
    expect(compareFractions(fraction(1, 4), fraction(1, 2))).toBe(-1);
  });

  it('returns 1 when the first fraction is larger', () => {
    expect(compareFractions(fraction(1, 2), fraction(1, 4))).toBe(1);
  });

  it('returns 0 for equal fractions in different forms', () => {
    expect(compareFractions(fraction(2, 4), fraction(1, 2))).toBe(0);
  });
});

describe('fractionToTicks', () => {
  it('converts a quarter note fraction to ppq ticks', () => {
    expect(fractionToTicks(fraction(1, 4), 480)).toBe(480);
  });

  it('converts a whole note fraction to 4*ppq ticks', () => {
    expect(fractionToTicks(fraction(1, 1), 480)).toBe(1920);
  });

  it('converts a dotted-eighth-equivalent fraction (3/16) correctly', () => {
    expect(fractionToTicks(fraction(3, 16), 480)).toBe(360);
  });

  it('rounds to the nearest integer tick when not evenly divisible', () => {
    expect(fractionToTicks(fraction(1, 3), 480)).toBe(Math.round((1 / 3) * 4 * 480));
  });
});
