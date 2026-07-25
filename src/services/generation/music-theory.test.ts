import { describe, expect, it } from 'vitest';
import { pitchToMidi } from '../../domain/pitch/pitch';
import type { KeySignature } from '@sudobility/music_types';
import {
  PROGRESSIONS,
  authenticCadence,
  chordPitches,
  expandProgressionToMeasures,
  keySignatureForTonicPitchClass,
  keyTonicPitchClass,
  lowestPitch,
  plagalCadence,
  progressionChordPitches,
  scaleDegreeToPitch,
  scaleNotes,
  scaleNotesOfType,
  snapPitchToScale,
} from './music-theory';

const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };
const A_MINOR: KeySignature = { fifths: 0, mode: 'minor' };
const G_MAJOR: KeySignature = { fifths: 1, mode: 'major' };
const D_MINOR: KeySignature = { fifths: -1, mode: 'minor' };

describe('keyTonicPitchClass', () => {
  it('resolves major key tonics via the circle of fifths', () => {
    expect(keyTonicPitchClass(C_MAJOR)).toBe(0); // C
    expect(keyTonicPitchClass(G_MAJOR)).toBe(7); // G
  });

  it('resolves minor key tonics as a minor third below the relative major', () => {
    expect(keyTonicPitchClass(A_MINOR)).toBe(9); // A
    expect(keyTonicPitchClass(D_MINOR)).toBe(2); // D
  });
});

describe('keySignatureForTonicPitchClass', () => {
  it('round-trips with keyTonicPitchClass for every pitch class and mode', () => {
    for (let pc = 0; pc < 12; pc += 1) {
      for (const mode of ['major', 'minor'] as const) {
        const key = keySignatureForTonicPitchClass(pc, mode);
        expect(key.mode).toBe(mode);
        expect(keyTonicPitchClass(key)).toBe(pc);
      }
    }
  });
});

describe('scaleDegreeToPitch / scaleNotesOfType', () => {
  it('builds a C major scale (degrees 0-7) as C D E F G A B C', () => {
    const notes = scaleNotesOfType(C_MAJOR, 4, 'major');
    expect(notes.map((p) => `${p.step}${p.accidental}`)).toEqual([
      'C0',
      'D0',
      'E0',
      'F0',
      'G0',
      'A0',
      'B0',
      'C0',
    ]);
    expect(notes[0].octave).toBe(4);
    expect(notes[7].octave).toBe(5);
  });

  it('wraps negative and beyond-span degrees into adjacent octaves', () => {
    const belowTonic = scaleDegreeToPitch(C_MAJOR, 'major', 4, -1); // leading tone below C4
    expect(pitchToMidi(belowTonic)).toBe(pitchToMidi({ step: 'B', accidental: 0, octave: 3 }));
  });

  it('scaleNotes defaults to major for major keys and natural minor for minor keys', () => {
    const major = scaleNotes(C_MAJOR, 4);
    const minor = scaleNotes(A_MINOR, 4);
    expect(major.map((p) => pitchToMidi(p) % 12)).toEqual([0, 2, 4, 5, 7, 9, 11, 0]);
    expect(minor.map((p) => pitchToMidi(p) % 12)).toEqual([9, 11, 0, 2, 4, 5, 7, 9]);
  });
});

describe('snapPitchToScale', () => {
  it('leaves an in-scale pitch unchanged (in pitch class)', () => {
    const midi = pitchToMidi({ step: 'E', accidental: 0, octave: 4 });
    const snapped = snapPitchToScale(midi, C_MAJOR, 'major');
    expect(pitchToMidi(snapped) % 12).toBe(midi % 12);
  });

  it('snaps a chromatic pitch to the nearest scale tone', () => {
    const csharp4 = pitchToMidi({ step: 'C', accidental: 1, octave: 4 });
    const snapped = snapPitchToScale(csharp4, C_MAJOR, 'major');
    expect([0, 2]).toContain(pitchToMidi(snapped) % 12); // C or D, whichever is nearer
  });
});

describe('chordPitches', () => {
  it('builds a major triad', () => {
    const root: import('@sudobility/music_types').Pitch = { step: 'C', accidental: 0, octave: 4 };
    const triad = chordPitches(root, 'major');
    expect(triad.map((p) => pitchToMidi(p) - pitchToMidi(root))).toEqual([0, 4, 7]);
  });

  it('builds a dominant 7th chord', () => {
    const root: import('@sudobility/music_types').Pitch = { step: 'G', accidental: 0, octave: 4 };
    const chord = chordPitches(root, 'dominant7');
    expect(chord.map((p) => pitchToMidi(p) - pitchToMidi(root))).toEqual([0, 4, 7, 10]);
  });
});

describe('progressionChordPitches / expandProgressionToMeasures', () => {
  it('resolves I-V-vi-IV in C major to C, G, Am, F triads', () => {
    const chords = progressionChordPitches(C_MAJOR, PROGRESSIONS['I-V-vi-IV'], 4);
    expect(chords).toHaveLength(4);
    const rootPitchClasses = chords.map((chord) => pitchToMidi(lowestPitch(chord)) % 12);
    expect(rootPitchClasses).toEqual([0, 7, 9, 5]); // C, G, A, F
  });

  it('twelve-bar-blues has 12 chords, all dominant7', () => {
    expect(PROGRESSIONS['twelve-bar-blues']).toHaveLength(12);
    expect(PROGRESSIONS['twelve-bar-blues'].every((c) => c.quality === 'dominant7')).toBe(true);
  });

  it('expandProgressionToMeasures cycles the progression to fill measureCount', () => {
    const measures = expandProgressionToMeasures(C_MAJOR, 'I-V-vi-IV', 6, 4);
    expect(measures).toHaveLength(6);
    // Measure 4 (index 4) should repeat measure 0's chord (progression length 4).
    expect(measures[4]).toEqual(measures[0]);
  });
});

describe('cadences', () => {
  it('authenticCadence resolves to the tonic triad', () => {
    const [, tonicChord] = authenticCadence(C_MAJOR, 4);
    expect(pitchToMidi(lowestPitch(tonicChord)) % 12).toBe(0);
  });

  it('plagalCadence resolves to the tonic triad', () => {
    const [, tonicChord] = plagalCadence(C_MAJOR, 4);
    expect(pitchToMidi(lowestPitch(tonicChord)) % 12).toBe(0);
  });
});
