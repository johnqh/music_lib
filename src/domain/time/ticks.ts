import type { DurationName, Fraction, TimeSignature } from '@sudobility/music_types';
import { fraction, fractionToTicks } from './fraction.js';

/** Multiplies a fraction by a positive integer/rational scalar expressed as a fraction. */
function scaleFraction(f: Fraction, scale: Fraction): Fraction {
  return fraction(f.numerator * scale.numerator, f.denominator * scale.denominator);
}

const DOTTED_SCALE = fraction(3, 2);
const TRIPLET_SCALE = fraction(2, 3);

const BASE_DURATIONS: Record<
  'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirtysecond',
  Fraction
> = {
  whole: fraction(1, 1),
  half: fraction(1, 2),
  quarter: fraction(1, 4),
  eighth: fraction(1, 8),
  sixteenth: fraction(1, 16),
  thirtysecond: fraction(1, 32),
};

/**
 * Duration name -> fraction of a whole note. Values are consumed by
 * `fractionToTicks`, where a quarter note (1/4) equals `ppq` ticks.
 */
export const DURATIONS: Record<DurationName, Fraction> = {
  whole: BASE_DURATIONS.whole,
  half: BASE_DURATIONS.half,
  quarter: BASE_DURATIONS.quarter,
  eighth: BASE_DURATIONS.eighth,
  sixteenth: BASE_DURATIONS.sixteenth,
  thirtysecond: BASE_DURATIONS.thirtysecond,
  'dotted-whole': scaleFraction(BASE_DURATIONS.whole, DOTTED_SCALE),
  'dotted-half': scaleFraction(BASE_DURATIONS.half, DOTTED_SCALE),
  'dotted-quarter': scaleFraction(BASE_DURATIONS.quarter, DOTTED_SCALE),
  'dotted-eighth': scaleFraction(BASE_DURATIONS.eighth, DOTTED_SCALE),
  'dotted-sixteenth': scaleFraction(BASE_DURATIONS.sixteenth, DOTTED_SCALE),
  'dotted-thirtysecond': scaleFraction(BASE_DURATIONS.thirtysecond, DOTTED_SCALE),
  'triplet-whole': scaleFraction(BASE_DURATIONS.whole, TRIPLET_SCALE),
  'triplet-half': scaleFraction(BASE_DURATIONS.half, TRIPLET_SCALE),
  'triplet-quarter': scaleFraction(BASE_DURATIONS.quarter, TRIPLET_SCALE),
  'triplet-eighth': scaleFraction(BASE_DURATIONS.eighth, TRIPLET_SCALE),
  'triplet-sixteenth': scaleFraction(BASE_DURATIONS.sixteenth, TRIPLET_SCALE),
  'triplet-thirtysecond': scaleFraction(BASE_DURATIONS.thirtysecond, TRIPLET_SCALE),
};

/** Integer tick length of a named duration at the given PPQ. */
export function ticksFor(duration: DurationName, ppq: number): number {
  return fractionToTicks(DURATIONS[duration], ppq);
}

/** Every duration name, in the order the table declares them. */
const DURATION_NAMES = Object.keys(DURATIONS) as DurationName[];

/**
 * The name of a duration `ticks` long, or `null` when nothing is exactly that.
 *
 * The inverse of `ticksFor`, and deliberately exact: a note that is 500 ticks
 * at 480 PPQ is not a quarter note, it is 500 ticks, and a control that
 * rounded it to "quarter" would relabel music it cannot represent. Callers
 * asking "what should the duration selector show" want `null` to mean "no
 * single name fits", which is a different answer from any name at all.
 *
 * Plain search rather than a reverse map: PPQ varies per score, so the tick
 * values are not constants and a cached map would have to be keyed by it for
 * the sake of eighteen comparisons.
 */
export function durationNameForTicks(ticks: number, ppq: number): DurationName | null {
  return DURATION_NAMES.find((name) => ticksFor(name, ppq) === ticks) ?? null;
}

/** Integer tick length of one full measure in the given time signature. */
export function measureDurationTicks(ts: TimeSignature, ppq: number): number {
  return fractionToTicks(fraction(ts.numerator, ts.denominator), ppq);
}

/**
 * Whether a time signature is compound (the beat subdivides into three,
 * e.g. 6/8, 9/8, 12/8, 6/4): numerator is a multiple of 3 greater than 3.
 */
function isCompoundMeter(ts: TimeSignature): boolean {
  return ts.numerator % 3 === 0 && ts.numerator > 3;
}

/**
 * Integer tick length of one beat in the given time signature. Simple meters
 * beat on a single denominator-note (e.g. 4/4 -> quarter). Compound meters
 * (numerator a multiple of 3, > 3) beat on a dotted denominator-note grouping
 * three denominator-notes (e.g. 6/8 -> dotted quarter).
 */
export function beatDurationTicks(ts: TimeSignature, ppq: number): number {
  const denominatorNoteTicks = fractionToTicks(fraction(1, ts.denominator), ppq);
  return isCompoundMeter(ts) ? 3 * denominatorNoteTicks : denominatorNoteTicks;
}

/** Tick offsets (relative to measure start) of each beat within a measure. */
export function beatBoundaries(ts: TimeSignature, ppq: number): number[] {
  const measureTicks = measureDurationTicks(ts, ppq);
  const beatTicks = beatDurationTicks(ts, ppq);
  const boundaries: number[] = [];
  for (let offset = 0; offset < measureTicks; offset += beatTicks) {
    boundaries.push(offset);
  }
  return boundaries;
}
