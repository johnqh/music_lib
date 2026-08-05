/**
 * How far a General MIDI program's written pitch sits from its sounding pitch.
 *
 * A transposing instrument is written in a key other than the one it sounds: a
 * B♭ trumpet reads a tone above what comes out, so concert C is written D.
 * This is a property of the instrument, not a preference — hand a clarinettist
 * a part at concert pitch and every note is wrong.
 *
 * Curated like `gm-range.ts` and `gm-polyphony.ts`: a default with overrides
 * for the programs that actually transpose. Most do not, so the table below is
 * only the exceptions.
 */
import { gmInstrument } from './gm.js';

/** Semitones to ADD to sounding pitch to get written pitch. */
const PROGRAM_TRANSPOSITION: Record<number, number> = {
  // Octave-transposing tuned percussion: written an octave (or two) below
  // where they sound, so the reader is not chasing ledger lines.
  8: -12, // Celesta
  9: -24, // Glockenspiel
  13: -12, // Xylophone

  // Guitars and basses are written an octave above where they sound.
  24: 12, // Acoustic Guitar (nylon)
  25: 12, // Acoustic Guitar (steel)
  26: 12, // Electric Guitar (jazz)
  27: 12, // Electric Guitar (clean)
  28: 12, // Electric Guitar (muted)
  29: 12, // Overdriven Guitar
  30: 12, // Distortion Guitar
  31: 12, // Guitar Harmonics
  32: 12, // Acoustic Bass
  33: 12, // Electric Bass (finger)
  34: 12, // Electric Bass (pick)
  35: 12, // Fretless Bass
  36: 12, // Slap Bass 1
  37: 12, // Slap Bass 2
  38: 12, // Synth Bass 1
  39: 12, // Synth Bass 2
  43: 12, // Contrabass

  // Brass.
  56: 2, // Trumpet — B♭
  60: 7, // French Horn — F

  // Reeds. The saxophone family transposes by four different intervals, which
  // is why they cannot share a family default.
  64: 2, // Soprano Sax — B♭
  65: 9, // Alto Sax — E♭
  66: 14, // Tenor Sax — B♭, a ninth below
  67: 21, // Baritone Sax — E♭, an octave and a sixth below
  69: 7, // English Horn — F
  71: 2, // Clarinet — B♭

  // Pipes.
  72: -12, // Piccolo — sounds an octave above where it is written
};

/**
 * Semitones to add to `program`'s sounding pitch to get its written pitch.
 *
 * `0` for anything written where it sounds, and for any program outside
 * 0-127: an unknown instrument is left alone rather than moved by a guess,
 * which would be a silently wrong part.
 */
export function gmWrittenTransposition(program: number): number {
  if (!gmInstrument(program)) return 0;
  return PROGRAM_TRANSPOSITION[program] ?? 0;
}

/** Whether `program` is written anywhere other than where it sounds. */
export function gmIsTransposing(program: number): boolean {
  return gmWrittenTransposition(program) !== 0;
}
