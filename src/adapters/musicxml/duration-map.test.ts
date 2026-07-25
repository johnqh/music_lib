import { describe, expect, it } from 'vitest';
import { notateDuration, ticksForNotatedType, isMusicXmlNoteType } from './duration-map';
import { ticksFor } from '../../domain/time/ticks';

const PPQ = 480;

describe('notateDuration', () => {
  it('notates every base duration as a single, undotted segment', () => {
    expect(notateDuration(ticksFor('whole', PPQ), PPQ)).toEqual([{ ticks: 1920, type: 'whole', dots: 0 }]);
    expect(notateDuration(ticksFor('half', PPQ), PPQ)).toEqual([{ ticks: 960, type: 'half', dots: 0 }]);
    expect(notateDuration(ticksFor('quarter', PPQ), PPQ)).toEqual([{ ticks: 480, type: 'quarter', dots: 0 }]);
    expect(notateDuration(ticksFor('eighth', PPQ), PPQ)).toEqual([{ ticks: 240, type: 'eighth', dots: 0 }]);
    expect(notateDuration(ticksFor('sixteenth', PPQ), PPQ)).toEqual([{ ticks: 120, type: '16th', dots: 0 }]);
    expect(notateDuration(ticksFor('thirtysecond', PPQ), PPQ)).toEqual([{ ticks: 60, type: '32nd', dots: 0 }]);
  });

  it('notates a dotted duration as a single segment with dots: 1', () => {
    expect(notateDuration(ticksFor('dotted-quarter', PPQ), PPQ)).toEqual([{ ticks: 720, type: 'quarter', dots: 1 }]);
    expect(notateDuration(ticksFor('dotted-half', PPQ), PPQ)).toEqual([{ ticks: 1440, type: 'half', dots: 1 }]);
  });

  it('splits an unrepresentable length into multiple tied-note segments, largest first, summing back to the total', () => {
    // 5 eighth notes (1200 ticks) is not a single (possibly dotted) note value.
    const segments = notateDuration(5 * ticksFor('eighth', PPQ), PPQ);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.reduce((sum, s) => sum + s.ticks, 0)).toBe(1200);
    for (const segment of segments) {
      expect(segment.ticks).toBeGreaterThan(0);
    }
  });

  it('returns [] for zero or negative ticks', () => {
    expect(notateDuration(0, PPQ)).toEqual([]);
    expect(notateDuration(-10, PPQ)).toEqual([]);
  });

  it('falls back to an undotted 32nd for a residual shorter than the smallest grid unit, preserving the true tick length', () => {
    const segments = notateDuration(1, PPQ); // 1 tick: far below a 32nd note (60 ticks at ppq 480)
    expect(segments).toEqual([{ ticks: 1, type: '32nd', dots: 0 }]);
  });
});

describe('ticksForNotatedType', () => {
  it('inverts notateDuration for every base and singly-dotted type', () => {
    expect(ticksForNotatedType('whole', 0, PPQ)).toBe(ticksFor('whole', PPQ));
    expect(ticksForNotatedType('quarter', 0, PPQ)).toBe(ticksFor('quarter', PPQ));
    expect(ticksForNotatedType('16th', 0, PPQ)).toBe(ticksFor('sixteenth', PPQ));
    expect(ticksForNotatedType('32nd', 0, PPQ)).toBe(ticksFor('thirtysecond', PPQ));
    expect(ticksForNotatedType('quarter', 1, PPQ)).toBe(ticksFor('dotted-quarter', PPQ));
    expect(ticksForNotatedType('half', 1, PPQ)).toBe(ticksFor('dotted-half', PPQ));
  });

  it('generalizes beyond a single dot (double-dotted = 1.75x base)', () => {
    expect(ticksForNotatedType('quarter', 2, PPQ)).toBe(Math.round(ticksFor('quarter', PPQ) * 1.75));
  });
});

describe('isMusicXmlNoteType', () => {
  it('accepts every supported type name and rejects unsupported ones', () => {
    for (const t of ['whole', 'half', 'quarter', 'eighth', '16th', '32nd']) {
      expect(isMusicXmlNoteType(t)).toBe(true);
    }
    for (const t of ['64th', 'breve', 'long', 'maxima', '']) {
      expect(isMusicXmlNoteType(t)).toBe(false);
    }
  });
});
