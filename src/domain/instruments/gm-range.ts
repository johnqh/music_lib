/**
 * A playable pitch range per General MIDI program.
 *
 * General MIDI defines names and programs but says nothing about compass, so
 * this is a curated table: a default per family, with overrides for the
 * instruments where the family default would be badly wrong. A piccolo and a
 * tuba are both "wind", and showing either one an 88-key piano tells the player
 * nothing about what will actually sound.
 *
 * The values are the conventional written-to-sounding ranges of the real
 * instruments, expressed as MIDI note numbers (60 = middle C). They are
 * intentionally the *practical* range rather than the extreme one — the point
 * is to show a keyboard whose keys are worth pressing, not to police input.
 * Nothing here restricts what can be written; it only decides which keys are
 * worth showing.
 */
import { gmFamilyOf, gmInstrument } from './gm.js';
import type { GmFamily } from './gm.js';

/** Inclusive MIDI note numbers. */
export type MidiRange = { min: number; max: number };

/** A0 to C8 — the 88-key piano, and the widest range anything here returns. */
export const FULL_KEYBOARD: MidiRange = { min: 21, max: 108 };

/**
 * Family defaults. Synth and effects families get a wide range on purpose:
 * they have no acoustic compass to respect, so narrowing them would be a
 * fiction.
 */
const FAMILY_RANGE: Record<GmFamily, MidiRange> = {
  piano: { min: 21, max: 108 },
  'chromatic-percussion': { min: 48, max: 96 },
  organ: { min: 36, max: 96 },
  guitar: { min: 40, max: 88 },
  bass: { min: 28, max: 67 },
  strings: { min: 36, max: 96 },
  ensemble: { min: 36, max: 96 },
  brass: { min: 34, max: 82 },
  reed: { min: 44, max: 88 },
  pipe: { min: 60, max: 98 },
  'synth-lead': { min: 24, max: 96 },
  'synth-pad': { min: 24, max: 96 },
  'synth-effects': { min: 24, max: 96 },
  ethnic: { min: 40, max: 84 },
  percussive: { min: 48, max: 84 },
  'sound-effects': { min: 21, max: 108 },
};

/** Instruments whose own compass differs enough from their family to matter. */
const PROGRAM_RANGE: Record<number, MidiRange> = {
  6: { min: 29, max: 89 }, // Harpsichord
  8: { min: 60, max: 108 }, // Celesta
  9: { min: 79, max: 108 }, // Glockenspiel
  11: { min: 53, max: 89 }, // Vibraphone
  12: { min: 36, max: 96 }, // Marimba
  13: { min: 65, max: 108 }, // Xylophone
  14: { min: 65, max: 89 }, // Tubular Bells
  19: { min: 24, max: 96 }, // Church Organ
  21: { min: 41, max: 81 }, // Accordion
  22: { min: 60, max: 96 }, // Harmonica
  40: { min: 55, max: 100 }, // Violin
  41: { min: 48, max: 88 }, // Viola
  42: { min: 36, max: 84 }, // Cello
  43: { min: 28, max: 67 }, // Contrabass
  46: { min: 24, max: 103 }, // Orchestral Harp
  47: { min: 38, max: 57 }, // Timpani
  52: { min: 48, max: 84 }, // Choir Aahs
  53: { min: 48, max: 84 }, // Voice Oohs
  56: { min: 52, max: 86 }, // Trumpet
  57: { min: 40, max: 77 }, // Trombone
  58: { min: 26, max: 65 }, // Tuba
  60: { min: 35, max: 77 }, // French Horn
  64: { min: 56, max: 88 }, // Soprano Sax
  65: { min: 49, max: 81 }, // Alto Sax
  66: { min: 44, max: 76 }, // Tenor Sax
  67: { min: 36, max: 69 }, // Baritone Sax
  68: { min: 58, max: 91 }, // Oboe
  69: { min: 52, max: 81 }, // English Horn
  70: { min: 34, max: 75 }, // Bassoon
  71: { min: 50, max: 94 }, // Clarinet
  72: { min: 74, max: 108 }, // Piccolo
  73: { min: 60, max: 98 }, // Flute
  74: { min: 65, max: 91 }, // Recorder
  105: { min: 48, max: 81 }, // Banjo
  106: { min: 48, max: 79 }, // Shamisen
  107: { min: 43, max: 84 }, // Koto
  108: { min: 53, max: 89 }, // Kalimba
};

/**
 * The practical range for `program`: its own if it has one, else its family's.
 *
 * An out-of-range program has no family, so it falls back to the full keyboard
 * rather than guessing.
 */
export function gmInstrumentRange(program: number): MidiRange {
  const override = PROGRAM_RANGE[program];
  if (override) return override;
  return gmInstrument(program) ? FAMILY_RANGE[gmFamilyOf(program)] : FULL_KEYBOARD;
}
