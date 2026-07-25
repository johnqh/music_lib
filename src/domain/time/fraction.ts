import type { Fraction } from '@sudobility/music_types';

/** Greatest common divisor (non-negative). */
function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** Constructs a `Fraction` from a numerator and denominator, unnormalized. */
export function fraction(numerator: number, denominator: number): Fraction {
  return { numerator, denominator };
}

/**
 * Reduces a fraction to lowest terms with a positive denominator.
 * Zero always normalizes to `0/1`. Throws on a zero denominator.
 */
export function normalizeFraction(f: Fraction): Fraction {
  if (f.denominator === 0) {
    throw new Error('normalizeFraction: denominator cannot be zero');
  }
  if (f.numerator === 0) {
    return { numerator: 0, denominator: 1 };
  }

  const sign = Math.sign(f.numerator) * Math.sign(f.denominator);
  const divisor = gcd(f.numerator, f.denominator);

  return {
    numerator: sign * (Math.abs(f.numerator) / divisor),
    denominator: Math.abs(f.denominator) / divisor,
  };
}

export function addFractions(a: Fraction, b: Fraction): Fraction {
  return normalizeFraction({
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  });
}

export function subtractFractions(a: Fraction, b: Fraction): Fraction {
  return normalizeFraction({
    numerator: a.numerator * b.denominator - b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  });
}

/** Returns -1, 0, or 1 depending on whether `a` is less than, equal to, or greater than `b`. */
export function compareFractions(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  const sign = Math.sign(a.denominator) * Math.sign(b.denominator);
  const diff = sign * (left - right);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/**
 * Converts a fraction of a whole note to integer ticks at the given PPQ.
 * A quarter note (1/4) equals `ppq` ticks, so a whole note equals `4 * ppq`.
 * Rounds to the nearest integer tick.
 */
export function fractionToTicks(f: Fraction, ppq: number): number {
  return Math.round((f.numerator / f.denominator) * 4 * ppq);
}
