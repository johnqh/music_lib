import { describe, expect, it } from 'vitest';
import { gmWrittenTransposition, gmIsTransposing } from './gm-transposition.js';
import { GM_INSTRUMENTS } from './gm.js';

describe('gmWrittenTransposition', () => {
  it('writes B-flat instruments a tone above what they sound', () => {
    expect(gmWrittenTransposition(56)).toBe(2); // Trumpet
    expect(gmWrittenTransposition(71)).toBe(2); // Clarinet
    expect(gmWrittenTransposition(64)).toBe(2); // Soprano Sax
  });

  it('writes F instruments a fifth above', () => {
    expect(gmWrittenTransposition(60)).toBe(7); // French Horn
    expect(gmWrittenTransposition(69)).toBe(7); // English Horn
  });

  it('writes the E-flat and lower B-flat saxes at their own intervals', () => {
    expect(gmWrittenTransposition(65)).toBe(9); // Alto Sax
    expect(gmWrittenTransposition(66)).toBe(14); // Tenor Sax — a ninth, not a tone
    expect(gmWrittenTransposition(67)).toBe(21); // Baritone Sax
  });

  it('writes the octave-transposing instruments an octave off', () => {
    // Guitar music is written an octave above where it sounds; piccolo an
    // octave below. Both are as real as the B-flat cases.
    expect(gmWrittenTransposition(24)).toBe(12); // Acoustic Guitar (nylon)
    expect(gmWrittenTransposition(32)).toBe(12); // Acoustic Bass
    expect(gmWrittenTransposition(43)).toBe(12); // Contrabass
    expect(gmWrittenTransposition(72)).toBe(-12); // Piccolo
    expect(gmWrittenTransposition(8)).toBe(-12); // Celesta
    expect(gmWrittenTransposition(13)).toBe(-12); // Xylophone
    expect(gmWrittenTransposition(9)).toBe(-24); // Glockenspiel
  });

  it('leaves a non-transposing instrument where it sounds', () => {
    expect(gmWrittenTransposition(0)).toBe(0); // Acoustic Grand Piano
    expect(gmWrittenTransposition(40)).toBe(0); // Violin
    expect(gmWrittenTransposition(73)).toBe(0); // Flute
  });

  it('gives an unknown program the benefit of the doubt', () => {
    // Moving a note by a guess is worse than leaving it alone.
    expect(gmWrittenTransposition(-1)).toBe(0);
    expect(gmWrittenTransposition(128)).toBe(0);
    expect(gmWrittenTransposition(3.5)).toBe(0);
  });

  it('returns a whole number of semitones for every program', () => {
    for (const instrument of GM_INSTRUMENTS) {
      const value = gmWrittenTransposition(instrument.program);
      expect(Number.isInteger(value), instrument.name).toBe(true);
      expect(Math.abs(value), instrument.name).toBeLessThanOrEqual(24);
    }
  });
});

describe('gmIsTransposing', () => {
  it('is true only for instruments written away from where they sound', () => {
    expect(gmIsTransposing(71)).toBe(true); // Clarinet
    expect(gmIsTransposing(24)).toBe(true); // Guitar, by an octave
    expect(gmIsTransposing(0)).toBe(false); // Piano
    expect(gmIsTransposing(73)).toBe(false); // Flute
  });
});
