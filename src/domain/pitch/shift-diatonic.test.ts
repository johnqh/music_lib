import { describe, expect, it } from 'vitest';
import { shiftDiatonic } from './transpose.js';
import type { Pitch } from '@sudobility/music_types';

const c4: Pitch = { step: 'C', accidental: 0, octave: 4 };

describe('shiftDiatonic', () => {
  it('moves by staff positions, not semitones', () => {
    // The point of being diatonic: E to F is one step and also one semitone,
    // while C to D is one step and two. A chromatic shift would make a dragged
    // note refuse to follow the pointer across E-F and B-C.
    expect(shiftDiatonic(c4, 1)).toEqual({ step: 'D', accidental: 0, octave: 4 });
    expect(shiftDiatonic({ step: 'E', accidental: 0, octave: 4 }, 1)).toEqual({
      step: 'F',
      accidental: 0,
      octave: 4,
    });
  });

  it('carries the octave across B and C in both directions', () => {
    expect(shiftDiatonic({ step: 'B', accidental: 0, octave: 4 }, 1)).toEqual({
      step: 'C',
      accidental: 0,
      octave: 5,
    });
    expect(shiftDiatonic(c4, -1)).toEqual({ step: 'B', accidental: 0, octave: 3 });
  });

  it('keeps the accidental, so dragging F# up gives G#', () => {
    expect(shiftDiatonic({ step: 'F', accidental: 1, octave: 4 }, 1)).toEqual({
      step: 'G',
      accidental: 1,
      octave: 4,
    });
  });

  it('handles multi-octave moves', () => {
    expect(shiftDiatonic(c4, 7)).toEqual({ step: 'C', accidental: 0, octave: 5 });
    expect(shiftDiatonic(c4, -7)).toEqual({ step: 'C', accidental: 0, octave: 3 });
    expect(shiftDiatonic(c4, 15)).toEqual({ step: 'D', accidental: 0, octave: 6 });
  });

  it('is a no-op for zero, and reverses itself', () => {
    expect(shiftDiatonic(c4, 0)).toBe(c4);
    expect(shiftDiatonic(shiftDiatonic(c4, 5), -5)).toEqual(c4);
  });
});
