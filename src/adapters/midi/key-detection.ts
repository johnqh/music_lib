/**
 * Krumhansl-style key estimation for MIDI import (spec §15): builds a
 * duration-weighted pitch-class histogram from a set of notes and
 * correlates it, at every tonic/mode rotation, against the classic
 * Krumhansl-Kessler major/minor key profiles, returning the best-matching
 * `KeySignature`. A simple template match, not a full Krumhansl-Schmuckler
 * implementation (spec explicitly allows this: "simple template match is
 * fine") — ambiguous or atonal input has no guaranteed "correct" answer
 * either way.
 */
import { pitchToMidi } from '../../domain/pitch/pitch';
import type { KeySignature, NoteEvent } from '@sudobility/music_types';
import { keySignatureForTonicPitchClass } from '../../services/generation/music-theory';

/** Krumhansl-Kessler major-key profile (tonic at index 0), a canonical perceptual "fit" weighting per scale degree. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
/** Krumhansl-Kessler minor-key profile (tonic at index 0). */
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const PITCH_CLASSES = 12;

/** Pearson correlation coefficient between two equal-length numeric vectors; 0 if either has zero variance. */
function correlate(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((sum, v) => sum + v, 0) / n;
  const meanB = b.reduce((sum, v) => sum + v, 0) / n;

  let numerator = 0;
  let sumSqA = 0;
  let sumSqB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    sumSqA += da * da;
    sumSqB += db * db;
  }

  const denominator = Math.sqrt(sumSqA * sumSqB);
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Builds a duration-weighted pitch-class (0-11) histogram from `notes`. */
function pitchClassHistogram(notes: NoteEvent[]): number[] {
  const histogram = new Array(PITCH_CLASSES).fill(0) as number[];
  for (const note of notes) {
    const pitchClass = ((pitchToMidi(note.pitch) % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES;
    histogram[pitchClass] += note.durationTicks;
  }
  return histogram;
}

/**
 * Estimates the best-fitting `KeySignature` for `notes` by correlating
 * their duration-weighted pitch-class histogram against the
 * Krumhansl-Kessler profiles at all 12 tonics, both major and minor, and
 * returning the highest-correlating (tonic, mode) pair. Falls back to C
 * major for an empty or entirely-silent `notes` list (histogram all-zero,
 * for which correlation is undefined).
 */
export function detectKeySignature(notes: NoteEvent[]): KeySignature {
  const histogram = pitchClassHistogram(notes);
  if (histogram.every((v) => v === 0)) {
    return { fifths: 0, mode: 'major' };
  }

  let bestScore = -Infinity;
  let bestTonic = 0;
  let bestMode: 'major' | 'minor' = 'major';

  for (let tonic = 0; tonic < PITCH_CLASSES; tonic += 1) {
    for (const [mode, profile] of [
      ['major', MAJOR_PROFILE],
      ['minor', MINOR_PROFILE],
    ] as const) {
      const expected = Array.from({ length: PITCH_CLASSES }, (_, pc) => profile[(pc - tonic + PITCH_CLASSES) % PITCH_CLASSES]);
      const score = correlate(histogram, expected);
      if (score > bestScore) {
        bestScore = score;
        bestTonic = tonic;
        bestMode = mode;
      }
    }
  }

  return keySignatureForTonicPitchClass(bestTonic, bestMode);
}
