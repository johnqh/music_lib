import type { KeySignature, Pitch } from '@sudobility/music_types';
import { midiToPitch, pitchToMidi } from './pitch.js';

/**
 * Transposes a pitch by a number of semitones (may be negative), re-spelling
 * the result according to the given key signature (see `midiToPitch`).
 */
export function transposePitch(p: Pitch, semitones: number, key?: KeySignature): Pitch {
  return midiToPitch(pitchToMidi(p) + semitones, key);
}

/**
 * Shifts a pitch by whole octaves, preserving its step and accidental
 * (diatonic spelling never changes for an octave-only transposition).
 */
export function transposeDiatonicOctave(p: Pitch, octaves: number): Pitch {
  return { ...p, octave: p.octave + octaves };
}
