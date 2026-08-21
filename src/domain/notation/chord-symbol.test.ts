import { describe, expect, it } from 'vitest';
import { parseChordSymbol } from './chord-symbol.js';

describe('parseChordSymbol', () => {
  it('reads a bare triad', () => {
    expect(parseChordSymbol('C')).toEqual({ step: 'C', alter: 0, quality: '' });
  });

  it('reads a sharp or flat root', () => {
    expect(parseChordSymbol('F#m')).toEqual({
      step: 'F',
      alter: 1,
      quality: 'm',
    });
    expect(parseChordSymbol('Bb7')).toEqual({
      step: 'B',
      alter: -1,
      quality: '7',
    });
  });

  it('accepts the typographic accidentals too', () => {
    // A player pasting from another program should not be refused.
    expect(parseChordSymbol('E♭maj7')).toEqual({
      step: 'E',
      alter: -1,
      quality: 'maj7',
    });
    expect(parseChordSymbol('C♯m7')).toEqual({
      step: 'C',
      alter: 1,
      quality: 'm7',
    });
  });

  it('keeps the quality exactly as written, whatever the dialect', () => {
    // C-7, Cmin7 and Cm7 are one chord written three ways. Classifying them
    // into an enumeration is a dictionary that is wrong for somebody.
    for (const quality of ['-7', 'min7', 'm7', 'maj7(add13)', '7#11', 'sus4']) {
      expect(parseChordSymbol(`C${quality}`)?.quality).toBe(quality);
    }
  });

  it('keeps a slash bass in the quality rather than losing it', () => {
    expect(parseChordSymbol('F/A')).toEqual({
      step: 'F',
      alter: 0,
      quality: '/A',
    });
  });

  it('refuses something that does not start on a note letter', () => {
    expect(parseChordSymbol('N.C.')).toBeNull();
    expect(parseChordSymbol('%')).toBeNull();
    expect(parseChordSymbol('')).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(parseChordSymbol('  Gm7  ')).toEqual({
      step: 'G',
      alter: 0,
      quality: 'm7',
    });
  });
});
