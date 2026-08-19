import { describe, expect, it } from 'vitest';
import {
  DURATIONS,
  beatBoundaries,
  beatDurationTicks,
  durationNameForTicks,
  measureDurationTicks,
  ticksFor,
} from './ticks.js';

const PPQ = 480;

describe('DURATIONS', () => {
  it('defines an entry for every base, dotted, and triplet duration name', () => {
    expect(Object.keys(DURATIONS).sort()).toEqual(
      [
        'whole',
        'half',
        'quarter',
        'eighth',
        'sixteenth',
        'thirtysecond',
        'dotted-whole',
        'dotted-half',
        'dotted-quarter',
        'dotted-eighth',
        'dotted-sixteenth',
        'dotted-thirtysecond',
        'triplet-whole',
        'triplet-half',
        'triplet-quarter',
        'triplet-eighth',
        'triplet-sixteenth',
        'triplet-thirtysecond',
      ].sort()
    );
  });
});

describe('ticksFor', () => {
  it('a quarter note equals ppq ticks', () => {
    expect(ticksFor('quarter', PPQ)).toBe(480);
  });

  it('a whole note equals 4 * ppq ticks', () => {
    expect(ticksFor('whole', PPQ)).toBe(1920);
  });

  it('an eighth note equals half a quarter note', () => {
    expect(ticksFor('eighth', PPQ)).toBe(240);
  });

  it('a dotted half note equals 1.5x a half note', () => {
    expect(ticksFor('dotted-half', PPQ)).toBe(1440);
  });

  it('a dotted quarter note equals 1.5x a quarter note', () => {
    expect(ticksFor('dotted-quarter', PPQ)).toBe(720);
  });

  it('a triplet eighth note equals 2/3 of an eighth note', () => {
    expect(ticksFor('triplet-eighth', PPQ)).toBe(160);
  });

  it('a triplet quarter note equals 2/3 of a quarter note', () => {
    expect(ticksFor('triplet-quarter', PPQ)).toBe(320);
  });
});

describe('measureDurationTicks', () => {
  it('4/4 measure equals 4 * ppq', () => {
    expect(measureDurationTicks({ numerator: 4, denominator: 4 }, PPQ)).toBe(
      4 * PPQ
    );
  });

  it('6/8 measure equals 3 * ppq', () => {
    expect(measureDurationTicks({ numerator: 6, denominator: 8 }, PPQ)).toBe(
      3 * PPQ
    );
  });

  it('3/4 measure equals 3 * ppq', () => {
    expect(measureDurationTicks({ numerator: 3, denominator: 4 }, PPQ)).toBe(
      3 * PPQ
    );
  });

  it('2/2 (cut time) measure equals 4 * ppq', () => {
    expect(measureDurationTicks({ numerator: 2, denominator: 2 }, PPQ)).toBe(
      4 * PPQ
    );
  });
});

describe('beatDurationTicks', () => {
  it('4/4 beat is a quarter note', () => {
    expect(beatDurationTicks({ numerator: 4, denominator: 4 }, PPQ)).toBe(
      ticksFor('quarter', PPQ)
    );
  });

  it('3/4 (simple triple) beat is a quarter note', () => {
    expect(beatDurationTicks({ numerator: 3, denominator: 4 }, PPQ)).toBe(
      ticksFor('quarter', PPQ)
    );
  });

  it('6/8 (compound duple) beat is a dotted quarter note', () => {
    expect(beatDurationTicks({ numerator: 6, denominator: 8 }, PPQ)).toBe(
      ticksFor('dotted-quarter', PPQ)
    );
  });

  it('9/8 (compound triple) beat is a dotted quarter note', () => {
    expect(beatDurationTicks({ numerator: 9, denominator: 8 }, PPQ)).toBe(
      ticksFor('dotted-quarter', PPQ)
    );
  });
});

describe('beatBoundaries', () => {
  it('4/4 has 4 beat boundaries starting at 0', () => {
    expect(beatBoundaries({ numerator: 4, denominator: 4 }, PPQ)).toEqual([
      0, 480, 960, 1440,
    ]);
  });

  it('6/8 has 2 beat boundaries (compound duple)', () => {
    expect(beatBoundaries({ numerator: 6, denominator: 8 }, PPQ)).toEqual([
      0, 720,
    ]);
  });

  it('3/4 has 3 beat boundaries', () => {
    expect(beatBoundaries({ numerator: 3, denominator: 4 }, PPQ)).toEqual([
      0, 480, 960,
    ]);
  });
});

describe('durationNameForTicks', () => {
  it('is the exact inverse of ticksFor for every name', () => {
    for (const ppq of [96, 480, 960]) {
      for (const name of [
        'whole',
        'half',
        'quarter',
        'eighth',
        'sixteenth',
        'thirtysecond',
        'dotted-quarter',
        'triplet-eighth',
      ] as const) {
        expect(
          durationNameForTicks(ticksFor(name, ppq), ppq),
          `${name}@${ppq}`
        ).toBe(name);
      }
    }
  });

  it('is null for a length no name covers, rather than the nearest one', () => {
    // A note of 500 ticks at 480 PPQ is not a quarter note; a selector that
    // rounded it to one would relabel music it cannot actually represent.
    expect(durationNameForTicks(500, 480)).toBeNull();
    expect(durationNameForTicks(0, 480)).toBeNull();
  });
});
