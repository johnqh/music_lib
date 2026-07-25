import { describe, expect, it } from 'vitest';
import { isPitchInRange, midiToPitch, pitchToMidi, pitchToString } from './pitch';
import type { Pitch } from '@sudobility/music_types';

describe('pitchToMidi', () => {
  it('C4 is midi 60', () => {
    expect(pitchToMidi({ step: 'C', accidental: 0, octave: 4 })).toBe(60);
  });

  it('A4 is midi 69', () => {
    expect(pitchToMidi({ step: 'A', accidental: 0, octave: 4 })).toBe(69);
  });

  it('C#4 is midi 61', () => {
    expect(pitchToMidi({ step: 'C', accidental: 1, octave: 4 })).toBe(61);
  });

  it('Db4 is enharmonically also midi 61', () => {
    expect(pitchToMidi({ step: 'D', accidental: -1, octave: 4 })).toBe(61);
  });

  it('C-1 (lowest MIDI octave) is midi 0', () => {
    expect(pitchToMidi({ step: 'C', accidental: 0, octave: -1 })).toBe(0);
  });

  it('handles a double sharp', () => {
    expect(pitchToMidi({ step: 'F', accidental: 2, octave: 4 })).toBe(
      pitchToMidi({
        step: 'G',
        accidental: 0,
        octave: 4,
      }),
    );
  });
});

describe('midiToPitch', () => {
  it('spells a natural pitch class the same regardless of key', () => {
    expect(midiToPitch(60)).toEqual({ step: 'C', accidental: 0, octave: 4 });
  });

  it('defaults to sharp spelling with no key signature', () => {
    expect(midiToPitch(61)).toEqual({ step: 'C', accidental: 1, octave: 4 });
  });

  it('spells midi 61 as C#4 in G major (1 sharp)', () => {
    const gMajor = { fifths: 1, mode: 'major' as const };
    expect(midiToPitch(61, gMajor)).toEqual({ step: 'C', accidental: 1, octave: 4 });
  });

  it('spells midi 61 as Db4 in Ab major (4 flats)', () => {
    const abMajor = { fifths: -4, mode: 'major' as const };
    expect(midiToPitch(61, abMajor)).toEqual({ step: 'D', accidental: -1, octave: 4 });
  });

  it('spells midi 70 as Bb4 in F major (1 flat)', () => {
    const fMajor = { fifths: -1, mode: 'major' as const };
    expect(midiToPitch(70, fMajor)).toEqual({ step: 'B', accidental: -1, octave: 4 });
  });

  it('round-trips through pitchToMidi', () => {
    for (const midi of [0, 1, 12, 13, 60, 61, 71, 127]) {
      expect(pitchToMidi(midiToPitch(midi))).toBe(midi);
    }
  });
});

describe('pitchToString', () => {
  it('formats a natural pitch', () => {
    expect(pitchToString({ step: 'C', accidental: 0, octave: 4 })).toBe('C4');
  });

  it('formats a sharp pitch', () => {
    expect(pitchToString({ step: 'F', accidental: 1, octave: 3 })).toBe('F#3');
  });

  it('formats a flat pitch', () => {
    expect(pitchToString({ step: 'B', accidental: -1, octave: 4 })).toBe('Bb4');
  });

  it('formats a double sharp pitch', () => {
    expect(pitchToString({ step: 'F', accidental: 2, octave: 4 })).toBe('F##4');
  });

  it('formats a double flat pitch', () => {
    expect(pitchToString({ step: 'B', accidental: -2, octave: 4 })).toBe('Bbb4');
  });

  it('formats a negative octave', () => {
    expect(pitchToString({ step: 'C', accidental: 0, octave: -1 })).toBe('C-1');
  });
});

describe('isPitchInRange', () => {
  const c4: Pitch = { step: 'C', accidental: 0, octave: 4 };

  it('is true when the pitch midi value is within the inclusive range', () => {
    expect(isPitchInRange(c4, 60, 72)).toBe(true);
    expect(isPitchInRange(c4, 48, 60)).toBe(true);
  });

  it('is false when the pitch midi value is below the range', () => {
    expect(isPitchInRange(c4, 61, 72)).toBe(false);
  });

  it('is false when the pitch midi value is above the range', () => {
    expect(isPitchInRange(c4, 20, 59)).toBe(false);
  });
});
