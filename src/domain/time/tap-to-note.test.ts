import { describe, expect, it } from 'vitest';
import { durationForTap } from './tap-to-note.js';

/** At 120bpm a quarter note is 500ms, so a whole note is 2000ms. */
describe('durationForTap', () => {
  it('matches the obvious taps at 120bpm', () => {
    expect(durationForTap(2000, 120)).toBe('whole');
    expect(durationForTap(1000, 120)).toBe('half');
    expect(durationForTap(500, 120)).toBe('quarter');
    expect(durationForTap(250, 120)).toBe('eighth');
    expect(durationForTap(125, 120)).toBe('sixteenth');
    expect(durationForTap(62, 120)).toBe('thirtysecond');
  });

  it('scales with tempo', () => {
    // A quarter is 250ms at 240bpm and 1000ms at 60.
    expect(durationForTap(250, 240)).toBe('quarter');
    expect(durationForTap(1000, 60)).toBe('quarter');
  });

  it('judges error as a ratio, not a difference', () => {
    // 40ms over is nothing against a whole note and everything against a
    // thirty-second. Absolute error would drag almost every tap to the longest.
    expect(durationForTap(2040, 120)).toBe('whole');
    expect(durationForTap(102, 120)).toBe('sixteenth');
  });

  it('rounds a tap between two values to the nearer in proportion', () => {
    // Geometric midpoint of quarter (500) and eighth (250) is ~354ms.
    expect(durationForTap(420, 120)).toBe('quarter');
    expect(durationForTap(300, 120)).toBe('eighth');
  });

  it('gives the shortest note to a stab, rather than nothing', () => {
    expect(durationForTap(1, 120)).toBe('thirtysecond');
    expect(durationForTap(0, 120)).toBe('thirtysecond');
  });

  it('gives the longest note to a very long hold', () => {
    expect(durationForTap(30_000, 120)).toBe('whole');
  });

  it('falls back to 120bpm rather than dividing by a nonsense tempo', () => {
    expect(durationForTap(500, 0)).toBe('quarter');
    expect(durationForTap(500, -60)).toBe('quarter');
  });
});
