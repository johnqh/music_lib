import { describe, expect, it } from 'vitest';
import { transposeDiatonicOctave, transposePitch } from './transpose.js';

describe('transposePitch', () => {
  it('transposes up by a whole step', () => {
    expect(transposePitch({ step: 'C', accidental: 0, octave: 4 }, 2)).toEqual({
      step: 'D',
      accidental: 0,
      octave: 4,
    });
  });

  it('transposes down across an octave boundary', () => {
    expect(transposePitch({ step: 'C', accidental: 0, octave: 4 }, -1)).toEqual({
      step: 'B',
      accidental: 0,
      octave: 3,
    });
  });

  it('transposes up across an octave boundary', () => {
    expect(transposePitch({ step: 'B', accidental: 0, octave: 3 }, 1)).toEqual({
      step: 'C',
      accidental: 0,
      octave: 4,
    });
  });

  it('uses the key signature to choose enharmonic spelling', () => {
    expect(
      transposePitch({ step: 'C', accidental: 0, octave: 4 }, 1, { fifths: -4, mode: 'major' }),
    ).toEqual({ step: 'D', accidental: -1, octave: 4 });
  });

  it('defaults to sharp spelling with no key signature', () => {
    expect(transposePitch({ step: 'C', accidental: 0, octave: 4 }, 1)).toEqual({
      step: 'C',
      accidental: 1,
      octave: 4,
    });
  });

  it('transposing by zero semitones returns an enharmonically-respelled equivalent pitch', () => {
    expect(transposePitch({ step: 'C', accidental: 0, octave: 4 }, 0)).toEqual({
      step: 'C',
      accidental: 0,
      octave: 4,
    });
  });
});

describe('transposeDiatonicOctave', () => {
  it('shifts up by whole octaves without changing step or accidental', () => {
    expect(transposeDiatonicOctave({ step: 'C', accidental: 1, octave: 4 }, 1)).toEqual({
      step: 'C',
      accidental: 1,
      octave: 5,
    });
  });

  it('shifts down by whole octaves', () => {
    expect(transposeDiatonicOctave({ step: 'C', accidental: 1, octave: 4 }, -2)).toEqual({
      step: 'C',
      accidental: 1,
      octave: 2,
    });
  });

  it('zero octaves returns the same pitch', () => {
    const p = { step: 'G' as const, accidental: -1 as const, octave: 3 };
    expect(transposeDiatonicOctave(p, 0)).toEqual(p);
  });
});
