import { describe, expect, it } from 'vitest';
import {
  transposeDiatonicOctave,
  transposeKeySignature,
  transposePitch,
} from './transpose.js';

describe('transposePitch', () => {
  it('transposes up by a whole step', () => {
    expect(transposePitch({ step: 'C', accidental: 0, octave: 4 }, 2)).toEqual({
      step: 'D',
      accidental: 0,
      octave: 4,
    });
  });

  it('transposes down across an octave boundary', () => {
    expect(transposePitch({ step: 'C', accidental: 0, octave: 4 }, -1)).toEqual(
      {
        step: 'B',
        accidental: 0,
        octave: 3,
      }
    );
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
      transposePitch({ step: 'C', accidental: 0, octave: 4 }, 1, {
        fifths: -4,
        mode: 'major',
      })
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
    expect(
      transposeDiatonicOctave({ step: 'C', accidental: 1, octave: 4 }, 1)
    ).toEqual({
      step: 'C',
      accidental: 1,
      octave: 5,
    });
  });

  it('shifts down by whole octaves', () => {
    expect(
      transposeDiatonicOctave({ step: 'C', accidental: 1, octave: 4 }, -2)
    ).toEqual({
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

describe('transposeKeySignature', () => {
  const major = (fifths: number) => ({ fifths, mode: 'major' as const });

  it('moves C major to D major for a B-flat instrument', () => {
    // Two sharps: the classic case, and the one most likely to be noticed.
    expect(transposeKeySignature(major(0), 2)).toEqual(major(2));
  });

  it('moves C major to G major for an F instrument', () => {
    expect(transposeKeySignature(major(0), 7)).toEqual(major(1));
  });

  it('moves C major to A major for an E-flat instrument', () => {
    expect(transposeKeySignature(major(0), 9)).toEqual(major(3));
  });

  it('moves C major to E-flat major for a minor third', () => {
    // Folds to the flat side rather than reporting nine sharps.
    expect(transposeKeySignature(major(0), 3)).toEqual(major(-3));
  });

  it('leaves the key alone for an octave', () => {
    // Guitar and piccolo transpose by octaves and keep their key signature.
    expect(transposeKeySignature(major(0), 12)).toEqual(major(0));
    expect(transposeKeySignature(major(3), -12)).toEqual(major(3));
    expect(transposeKeySignature(major(0), -24)).toEqual(major(0));
  });

  it('gives the tenor sax the same key as the other B-flat instruments', () => {
    // +14 is +2 an octave down; the key must not differ from the trumpet's.
    expect(transposeKeySignature(major(0), 14)).toEqual(
      transposeKeySignature(major(0), 2)
    );
  });

  it('keeps the mode', () => {
    expect(transposeKeySignature({ fifths: 0, mode: 'minor' }, 2).mode).toBe(
      'minor'
    );
  });

  it('never returns a key needing more than seven accidentals', () => {
    // Seven sharps is spellable; eight is not. Folding is what keeps every
    // result printable, including from an already-remote starting key.
    for (let semitones = -24; semitones <= 24; semitones++) {
      for (const start of [-5, -3, 0, 3, 5]) {
        const result = transposeKeySignature(major(start), semitones);
        expect(
          Math.abs(result.fifths),
          `${start} by ${semitones}`
        ).toBeLessThanOrEqual(7);
      }
    }
  });
});
