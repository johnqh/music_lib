/**
 * Musically-useful theory helpers backing the seeded mock generator (spec
 * §31): scales, key-signature <-> tonic conversions, chords, common
 * progressions, and cadences. Pure functions of `KeySignature`/`Pitch`
 * values — no randomness here (that lives in `prng.ts`/`patterns/*`).
 */
import type { KeySignature, Pitch } from '@sudobility/music_types';
import { midiToPitch, pitchToMidi } from '../../domain/pitch/pitch';
import { transposeDiatonicOctave } from '../../domain/pitch/transpose';

export type ScaleType = 'major' | 'naturalMinor' | 'harmonicMinor' | 'majorPentatonic' | 'minorPentatonic';

/** Semitone offsets from the tonic for each scale type, one octave. */
export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

/** The default scale for a key signature: major for major keys, natural minor for minor keys. */
export function defaultScaleType(key: KeySignature): ScaleType {
  return key.mode === 'major' ? 'major' : 'naturalMinor';
}

/**
 * Pitch class (0-11, C=0) of a major key's tonic at `fifths` steps around
 * the circle of fifths (each fifth = +7 semitones mod 12, starting at C=0).
 */
function majorTonicPitchClass(fifths: number): number {
  return (((7 * fifths) % 12) + 12) % 12;
}

/**
 * Pitch class (0-11, C=0) of `key`'s tonic. Major keys: direct circle-of-
 * fifths lookup. Minor keys: `key.fifths` names the same key signature as
 * its relative major (spec §4's `KeySignature`, matching standard notation
 * practice), whose tonic sits a minor third below the minor tonic — so the
 * minor tonic is the relative major's tonic minus 3 semitones (e.g. fifths
 * 0/major -> C; fifths 0/minor -> A, and A is C - 3 semitones, mod 12).
 */
export function keyTonicPitchClass(key: KeySignature): number {
  const majorRoot = majorTonicPitchClass(key.fifths);
  return key.mode === 'major' ? majorRoot : (((majorRoot - 3) % 12) + 12) % 12;
}

/**
 * Inverse of `keyTonicPitchClass`: the `KeySignature` (fifths -7..7) whose
 * tonic is `pitchClass` in the given `mode`. Used by prompt parsing to turn
 * a recognized key name (e.g. "D minor") into a `KeySignature`.
 */
export function keySignatureForTonicPitchClass(pitchClass: number, mode: 'major' | 'minor'): KeySignature {
  const majorPitchClass = mode === 'major' ? pitchClass : (pitchClass + 3) % 12;
  for (let fifths = -7; fifths <= 7; fifths += 1) {
    if (majorTonicPitchClass(fifths) === majorPitchClass) {
      return { fifths, mode };
    }
  }
  // Unreachable: every pitch class 0-11 has a major-key fifths value in [-7, 7] covering all 12 classes once each.
  throw new Error(`keySignatureForTonicPitchClass: no key signature found for pitch class ${pitchClass}`);
}

/**
 * The `Pitch` for scale degree `degree` (0-indexed; 0 = tonic) of
 * `scaleType`, rooted in `key` at `baseOctave`. Degrees outside `[0,
 * span)` wrap into adjacent octaves (e.g. degree -1 is the leading tone
 * below the tonic; degree = span is the tonic an octave up), so callers can
 * do unclamped scale-degree arithmetic (contour walks, chord voicings).
 */
export function scaleDegreeToPitch(
  key: KeySignature,
  scaleType: ScaleType,
  baseOctave: number,
  degree: number,
): Pitch {
  const intervals = SCALE_INTERVALS[scaleType];
  const span = intervals.length;
  const octaveShift = Math.floor(degree / span);
  const index = ((degree % span) + span) % span;
  const tonic = keyTonicPitchClass(key);
  const rootMidi = (baseOctave + 1) * 12 + tonic;
  return midiToPitch(rootMidi + octaveShift * 12 + intervals[index], key);
}

/**
 * The notes of `scaleType` rooted in `key`, one octave ascending from
 * `baseOctave` (degrees 0..span inclusive: every scale degree plus the
 * octave repeat of the tonic).
 */
export function scaleNotesOfType(key: KeySignature, baseOctave: number, scaleType: ScaleType): Pitch[] {
  const span = SCALE_INTERVALS[scaleType].length;
  const notes: Pitch[] = [];
  for (let degree = 0; degree <= span; degree += 1) {
    notes.push(scaleDegreeToPitch(key, scaleType, baseOctave, degree));
  }
  return notes;
}

/** `scaleNotesOfType` using `key`'s default scale (major scale for major keys, natural minor for minor keys). */
export function scaleNotes(key: KeySignature, baseOctave: number): Pitch[] {
  return scaleNotesOfType(key, baseOctave, defaultScaleType(key));
}

/**
 * Snaps `midi` to the nearest pitch class belonging to `scaleType` rooted
 * in `key` (searching outward by semitone, ties broken downward), and
 * spells the result per `key`. Used by melodic variation transforms to
 * keep randomized pitch nudges diatonic.
 */
export function snapPitchToScale(midi: number, key: KeySignature, scaleType: ScaleType): Pitch {
  const tonic = keyTonicPitchClass(key);
  const scalePitchClasses = new Set(SCALE_INTERVALS[scaleType].map((interval) => (tonic + interval) % 12));
  const pitchClassOf = (m: number): number => (((m % 12) + 12) % 12);

  if (scalePitchClasses.has(pitchClassOf(midi))) {
    return midiToPitch(midi, key);
  }
  for (let delta = 1; delta <= 6; delta += 1) {
    if (scalePitchClasses.has(pitchClassOf(midi - delta))) return midiToPitch(midi - delta, key);
    if (scalePitchClasses.has(pitchClassOf(midi + delta))) return midiToPitch(midi + delta, key);
  }
  return midiToPitch(midi, key);
}

export type ChordQuality = 'major' | 'minor' | 'diminished' | 'augmented' | 'dominant7' | 'major7' | 'minor7';

const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
};

/** The pitches of a chord of `quality` rooted at `root` (spelled per `key`, defaulting to `root`'s own spelling context if omitted). */
export function chordPitches(root: Pitch, quality: ChordQuality, key?: KeySignature): Pitch[] {
  const rootMidi = pitchToMidi(root);
  return CHORD_INTERVALS[quality].map((interval) => midiToPitch(rootMidi + interval, key));
}

export type ProgressionChord = { degree: number; quality: ChordQuality };

export type ProgressionName = 'I-V-vi-IV' | 'ii-V-I' | 'i-VI-III-VII' | 'I-vi-IV-V' | 'twelve-bar-blues';

const degreeChord = (degree: number, quality: ChordQuality): ProgressionChord => ({ degree, quality });

/** Spec §31/§11 example progressions, given as 1-indexed diatonic scale degrees + explicit chord quality. */
export const PROGRESSIONS: Record<ProgressionName, ProgressionChord[]> = {
  'I-V-vi-IV': [degreeChord(1, 'major'), degreeChord(5, 'major'), degreeChord(6, 'minor'), degreeChord(4, 'major')],
  'ii-V-I': [degreeChord(2, 'minor'), degreeChord(5, 'dominant7'), degreeChord(1, 'major7')],
  'i-VI-III-VII': [
    degreeChord(1, 'minor'),
    degreeChord(6, 'major'),
    degreeChord(3, 'major'),
    degreeChord(7, 'major'),
  ],
  'I-vi-IV-V': [degreeChord(1, 'major'), degreeChord(6, 'minor'), degreeChord(4, 'major'), degreeChord(5, 'major')],
  'twelve-bar-blues': [1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5].map((degree) => degreeChord(degree, 'dominant7')),
};

/**
 * Resolves each chord in `progression` to concrete pitches, rooting each
 * chord's degree in `key`'s own default diatonic scale (major scale for
 * major keys, natural minor for minor keys) at `octave`.
 */
export function progressionChordPitches(
  key: KeySignature,
  progression: ProgressionChord[],
  octave: number,
): Pitch[][] {
  const scale = scaleNotesOfType(key, octave, defaultScaleType(key));
  return progression.map(({ degree, quality }) => chordPitches(scale[(degree - 1) % 7], quality, key));
}

/** Cycles `progression` to cover exactly `measureCount` measures (one chord per measure, repeating the progression as needed). */
export function expandProgressionToMeasures(
  key: KeySignature,
  progressionName: ProgressionName,
  measureCount: number,
  octave: number,
): Pitch[][] {
  const chords = progressionChordPitches(key, PROGRESSIONS[progressionName], octave);
  const result: Pitch[][] = [];
  for (let m = 0; m < measureCount; m += 1) {
    result.push(chords[m % chords.length]);
  }
  return result;
}

/** The lowest-pitched note of a (non-empty) chord. */
export function lowestPitch(chord: Pitch[]): Pitch {
  return [...chord].sort((a, b) => pitchToMidi(a) - pitchToMidi(b))[0];
}

/** Max octave shifts `clampPitchToMidiRange` tries in each direction before giving up (bounds against a pathological/empty range). */
const MAX_OCTAVE_SHIFTS = 10;

/**
 * Transposes `pitch` by whole octaves until its MIDI value falls within
 * `range` (a no-op when `range` is omitted). Diatonic (octave-only)
 * transposition preserves the pitch's letter-name spelling, unlike
 * respelling via `midiToPitch`. Bounded to `MAX_OCTAVE_SHIFTS` octaves each
 * direction so a range narrower than a semitone step of 12 can't spin
 * forever; such a range simply returns the closest reachable pitch.
 */
export function clampPitchToMidiRange(pitch: Pitch, range?: { lowestMidi: number; highestMidi: number }): Pitch {
  if (!range) return pitch;
  let result = pitch;
  for (let i = 0; i < MAX_OCTAVE_SHIFTS && pitchToMidi(result) < range.lowestMidi; i += 1) {
    result = transposeDiatonicOctave(result, 1);
  }
  for (let i = 0; i < MAX_OCTAVE_SHIFTS && pitchToMidi(result) > range.highestMidi; i += 1) {
    result = transposeDiatonicOctave(result, -1);
  }
  return result;
}

/** A two-chord authentic (V-I) cadence in `key` at `octave`; dominant7-to-tonic in major keys, minor-v-to-i in natural minor. */
export function authenticCadence(key: KeySignature, octave: number): Pitch[][] {
  const scale = scaleNotesOfType(key, octave, defaultScaleType(key));
  const isMajor = key.mode === 'major';
  return [
    chordPitches(scale[4], isMajor ? 'dominant7' : 'minor', key),
    chordPitches(scale[0], isMajor ? 'major' : 'minor', key),
  ];
}

/** A two-chord plagal (IV-I) cadence in `key` at `octave`. */
export function plagalCadence(key: KeySignature, octave: number): Pitch[][] {
  const scale = scaleNotesOfType(key, octave, defaultScaleType(key));
  const isMajor = key.mode === 'major';
  return [
    chordPitches(scale[3], isMajor ? 'major' : 'minor', key),
    chordPitches(scale[0], isMajor ? 'major' : 'minor', key),
  ];
}
