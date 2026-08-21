import { describe, expect, it } from 'vitest';
import { shiftToFitRange } from './instrument-fit.js';

const RANGE = { min: 60, max: 72 };

describe('shiftToFitRange', () => {
  it('does not move a part that already fits', () => {
    // 0 and null are different answers — "no move needed" versus "cannot be
    // done" — so this asserts the number rather than falsiness.
    expect(shiftToFitRange([60, 64, 72], RANGE)).toBe(0);
  });

  it('treats an empty part as fitting anything', () => {
    expect(shiftToFitRange([], RANGE)).toBe(0);
  });

  it('prefers whole octaves, so the pitch classes survive', () => {
    // A fifth below the range could be fixed with 5 semitones, but that
    // rewrites the tune; an octave keeps it recognisable.
    expect(shiftToFitRange([48, 52], RANGE)).toBe(12);
  });

  it('takes the octave shift closest to leaving it alone', () => {
    expect(shiftToFitRange([24, 28], RANGE)).toBe(36);
  });

  it('falls back to semitones when no octave shift fits', () => {
    // A part spanning 59-71 is one semitone below a 60-72 window: no multiple
    // of 12 lands it inside, so the smallest chromatic move wins.
    expect(shiftToFitRange([59, 71], RANGE)).toBe(1);
  });

  it('refuses a part wider than the compass', () => {
    expect(shiftToFitRange([48, 96], RANGE)).toBeNull();
  });
});
