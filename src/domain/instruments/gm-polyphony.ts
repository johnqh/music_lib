/**
 * How many notes a General MIDI program can sound at once.
 *
 * General MIDI says nothing about this, so — like `gm-range.ts` — it is a
 * curated table: a default per family, with overrides where the family default
 * would be wrong. The numbers are physical facts about the instruments, not
 * preferences: a trumpet player has one airstream, a guitar has six strings, a
 * violinist can bow two strings at once (and briefly break three).
 *
 * This exists so the editor can refuse to write a chord nobody could play. It
 * deliberately does NOT describe what a synthesizer patch can do — polyphony
 * there is a setting, not a limit — so every synth family is unlimited.
 */
import { gmFamilyOf, gmInstrument } from './gm.js';
import type { GmFamily } from './gm.js';

/** No physical limit: keyboards, plucked strings, sections, synths, drums. */
export const UNLIMITED_POLYPHONY = Number.POSITIVE_INFINITY;

/**
 * Family defaults.
 *
 * Wind and brass are 1 because one player has one airstream. Bowed strings are
 * 2 for double stops. Everything else is unlimited — including the synth
 * families, where polyphony is a patch setting rather than a property of the
 * instrument, and blocking a chord there would be an invented restriction.
 */
const FAMILY_POLYPHONY: Record<GmFamily, number> = {
  piano: UNLIMITED_POLYPHONY,
  'chromatic-percussion': UNLIMITED_POLYPHONY,
  organ: UNLIMITED_POLYPHONY,
  guitar: 6,
  bass: 4,
  strings: 2,
  ensemble: UNLIMITED_POLYPHONY,
  brass: 1,
  reed: 1,
  pipe: 1,
  'synth-lead': UNLIMITED_POLYPHONY,
  'synth-pad': UNLIMITED_POLYPHONY,
  'synth-effects': UNLIMITED_POLYPHONY,
  ethnic: UNLIMITED_POLYPHONY,
  percussive: UNLIMITED_POLYPHONY,
  'sound-effects': UNLIMITED_POLYPHONY,
};

/** Programs whose own limit differs from their family's. */
const PROGRAM_POLYPHONY: Record<number, number> = {
  // In the strings family but not bowed: both are chordal instruments.
  46: UNLIMITED_POLYPHONY, // Orchestral Harp
  47: UNLIMITED_POLYPHONY, // Timpani — a set of drums, not one
  // Sections, not soloists, despite sitting in the brass family.
  61: UNLIMITED_POLYPHONY, // Brass Section
  62: UNLIMITED_POLYPHONY, // Synth Brass 1
  63: UNLIMITED_POLYPHONY, // Synth Brass 2
  // Single-line players inside the otherwise-chordal ethnic family.
  109: 1, // Bagpipe
  110: 2, // Fiddle — bowed, so double stops
  111: 1, // Shanai
};

/**
 * The most notes `program` can sound simultaneously.
 *
 * Returns `UNLIMITED_POLYPHONY` for anything chordal, and for any program
 * outside 0-127 — an unknown instrument gets the benefit of the doubt rather
 * than having edits blocked against a guess.
 */
export function gmMaxPolyphony(program: number): number {
  const override = PROGRAM_POLYPHONY[program];
  if (override !== undefined) return override;
  return gmInstrument(program)
    ? FAMILY_POLYPHONY[gmFamilyOf(program)]
    : UNLIMITED_POLYPHONY;
}

/** Whether `program` can sound `count` notes at once. */
export function gmSupportsChord(program: number, count: number): boolean {
  return count <= gmMaxPolyphony(program);
}
