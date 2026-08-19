import type {
  Accidental,
  KeySignature,
  Pitch,
  PitchStep,
} from '@sudobility/music_types';

/** Semitone offset from C for each natural pitch step (no accidental). */
const NATURAL_STEP_SEMITONES: Record<PitchStep, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** MIDI note number for C4 ("middle C"), per spec §4 (C4 = 60). */
const MIDI_C4 = 60;
const C4_OCTAVE = 4;

/** Converts a `Pitch` to its MIDI note number (C4 = 60, A4 = 69). */
export function pitchToMidi(p: Pitch): number {
  return (
    MIDI_C4 +
    (p.octave - C4_OCTAVE) * 12 +
    NATURAL_STEP_SEMITONES[p.step] +
    p.accidental
  );
}

/** step/accidental spelling for each pitch class 0-11, preferring sharps. */
const SHARP_SPELLING: Array<{ step: PitchStep; accidental: Accidental }> = [
  { step: 'C', accidental: 0 },
  { step: 'C', accidental: 1 },
  { step: 'D', accidental: 0 },
  { step: 'D', accidental: 1 },
  { step: 'E', accidental: 0 },
  { step: 'F', accidental: 0 },
  { step: 'F', accidental: 1 },
  { step: 'G', accidental: 0 },
  { step: 'G', accidental: 1 },
  { step: 'A', accidental: 0 },
  { step: 'A', accidental: 1 },
  { step: 'B', accidental: 0 },
];

/** step/accidental spelling for each pitch class 0-11, preferring flats. */
const FLAT_SPELLING: Array<{ step: PitchStep; accidental: Accidental }> = [
  { step: 'C', accidental: 0 },
  { step: 'D', accidental: -1 },
  { step: 'D', accidental: 0 },
  { step: 'E', accidental: -1 },
  { step: 'E', accidental: 0 },
  { step: 'F', accidental: 0 },
  { step: 'G', accidental: -1 },
  { step: 'G', accidental: 0 },
  { step: 'A', accidental: -1 },
  { step: 'A', accidental: 0 },
  { step: 'B', accidental: -1 },
  { step: 'B', accidental: 0 },
];

/**
 * Converts a MIDI note number to a `Pitch`, choosing an enharmonic spelling
 * appropriate to the given key signature: sharps for sharp/neutral keys
 * (`fifths >= 0`), flats for flat keys (`fifths < 0`). Defaults to sharp
 * spelling when no key signature is given.
 */
export function midiToPitch(midi: number, keySignature?: KeySignature): Pitch {
  const useSharps = keySignature === undefined || keySignature.fifths >= 0;
  const spelling = useSharps ? SHARP_SPELLING : FLAT_SPELLING;

  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const { step, accidental } = spelling[pitchClass];

  return { step, accidental, octave };
}

const ACCIDENTAL_SYMBOLS: Record<Accidental, string> = {
  [-2]: 'bb',
  [-1]: 'b',
  [0]: '',
  [1]: '#',
  [2]: '##',
};

/** Formats a `Pitch` as a string, e.g. `C4`, `F#3`, `Bb4`, `F##4`. */
export function pitchToString(p: Pitch): string {
  return `${p.step}${ACCIDENTAL_SYMBOLS[p.accidental]}${p.octave}`;
}

/** Whether a pitch's MIDI value falls within an inclusive range. */
export function isPitchInRange(
  p: Pitch,
  lowestMidi: number,
  highestMidi: number
): boolean {
  const midi = pitchToMidi(p);
  return midi >= lowestMidi && midi <= highestMidi;
}
