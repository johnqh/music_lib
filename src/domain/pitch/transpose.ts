import type { KeySignature, Pitch, PitchStep } from '@sudobility/music_types';
import { midiToPitch, pitchToMidi } from './pitch.js';

/**
 * Transposes a pitch by a number of semitones (may be negative), re-spelling
 * the result according to the given key signature (see `midiToPitch`).
 */
export function transposePitch(
  p: Pitch,
  semitones: number,
  key?: KeySignature
): Pitch {
  return midiToPitch(pitchToMidi(p) + semitones, key);
}

/**
 * Shifts a pitch by whole octaves, preserving its step and accidental
 * (diatonic spelling never changes for an octave-only transposition).
 */
export function transposeDiatonicOctave(p: Pitch, octaves: number): Pitch {
  return { ...p, octave: p.octave + octaves };
}

/** The seven letter names, in order, for diatonic movement. */
const STEPS: readonly PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * Moves `p` by `steps` positions on the staff — one step per line-to-adjacent-
 * space — keeping its accidental.
 *
 * Diatonic, not chromatic, because this exists for dragging a note up and down
 * a staff: the reader is moving it to a *staff position*, and one position is
 * a tone in some places and a semitone in others. Transposing by semitones
 * would make the note refuse to follow the pointer across E-F and B-C.
 *
 * The accidental rides along unchanged, which is what a drag should do: moving
 * F# up one step gives G#, not G. Respelling is the caller's business.
 */
export function shiftDiatonic(p: Pitch, steps: number): Pitch {
  if (steps === 0) return p;
  const index = STEPS.indexOf(p.step);
  if (index < 0) return p;

  const absolute = index + steps;
  // Floor division, so it works for downward moves as well as upward.
  const octaveShift = Math.floor(absolute / STEPS.length);
  const wrapped = ((absolute % STEPS.length) + STEPS.length) % STEPS.length;

  return { ...p, step: STEPS[wrapped], octave: p.octave + octaveShift };
}

/**
 * The key `key` becomes when the music is transposed by `semitones`.
 *
 * Moving up a fifth adds one sharp, so a shift of `s` semitones moves the key
 * by `s × 7` fifths — the circle of fifths advances 7 semitones per step. The
 * result is folded into -6..6 so a minor third up reads as three flats rather
 * than nine sharps: both name the same key, but only one is printable.
 *
 * An octave leaves the key untouched, which falls out of the arithmetic rather
 * than needing a special case.
 */
export function transposeKeySignature(
  key: KeySignature,
  semitones: number
): KeySignature {
  const raw = (((semitones * 7) % 12) + 12) % 12;
  const delta = raw > 6 ? raw - 12 : raw;

  let fifths = key.fifths + delta;
  // The sum can still land outside the printable range when the starting key
  // is already remote; fold it back the same way.
  while (fifths > 7) fifths -= 12;
  while (fifths < -7) fifths += 12;

  return { fifths, mode: key.mode };
}
