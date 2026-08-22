/**
 * Saying score values the way a musician says them.
 *
 * A score stores ticks, fifths and zero-based voice indexes because those are
 * the right things to compute with. None of them is the right thing to *show*:
 * a property panel that reads "Duration 480" and "Key (fifths) 2" is stating
 * the storage format, and the reader has to convert in their head to know they
 * are looking at a quarter note in D major.
 *
 * These are the conversions, kept in one place so every surface agrees — and
 * kept here rather than in an app, because which tick count is a quarter note
 * and how many sharps D major has are facts about music, not about a panel.
 *
 * No user-facing prose lives here: note values and key names are the terms of
 * the domain, fixed across locales the way General MIDI's instrument names are.
 */
import type {
  Clef,
  DurationName,
  KeySignature,
  Pitch,
  Score,
  TimeSignature,
} from '@sudobility/music_types';
import { DURATIONS, beatDurationTicks } from '../time/ticks.js';
import { barNumberAt, indexOfBarNumber } from '../score/bar-numbers.js';
import { shiftDiatonic } from '../pitch/transpose.js';

// ---- durations -------------------------------------------------------------

/** Every duration name, longest first, so a picker reads top to bottom. */
export const DURATION_NAMES = Object.keys(DURATIONS) as DurationName[];

const DURATION_LABELS: Record<DurationName, string> = {
  whole: 'Whole',
  half: 'Half',
  quarter: 'Quarter',
  eighth: 'Eighth',
  sixteenth: '16th',
  thirtysecond: '32nd',
  'dotted-whole': 'Dotted whole',
  'dotted-half': 'Dotted half',
  'dotted-quarter': 'Dotted quarter',
  'dotted-eighth': 'Dotted eighth',
  'dotted-sixteenth': 'Dotted 16th',
  'dotted-thirtysecond': 'Dotted 32nd',
  'triplet-whole': 'Whole triplet',
  'triplet-half': 'Half triplet',
  'triplet-quarter': 'Quarter triplet',
  'triplet-eighth': 'Eighth triplet',
  'triplet-sixteenth': '16th triplet',
  'triplet-thirtysecond': '32nd triplet',
};

/** What to call `name` in a picker. */
export function durationLabel(name: DurationName): string {
  return DURATION_LABELS[name];
}

// ---- key signatures --------------------------------------------------------

/** Sharps are positive, flats negative — the MusicXML convention the model stores. */
const MAJOR_KEYS: Record<number, string> = {
  [-7]: 'C♭',
  [-6]: 'G♭',
  [-5]: 'D♭',
  [-4]: 'A♭',
  [-3]: 'E♭',
  [-2]: 'B♭',
  [-1]: 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  5: 'B',
  6: 'F♯',
  7: 'C♯',
};

const MINOR_KEYS: Record<number, string> = {
  [-7]: 'A♭',
  [-6]: 'E♭',
  [-5]: 'B♭',
  [-4]: 'F',
  [-3]: 'C',
  [-2]: 'G',
  [-1]: 'D',
  0: 'A',
  1: 'E',
  2: 'B',
  3: 'F♯',
  4: 'C♯',
  5: 'G♯',
  6: 'D♯',
  7: 'A♯',
};

/** The number of sharps or flats a signature carries, as a phrase. */
export function accidentalCountLabel(fifths: number): string {
  if (fifths === 0) return 'no sharps or flats';
  const count = Math.abs(fifths);
  const kind = fifths > 0 ? 'sharp' : 'flat';
  return `${count} ${kind}${count === 1 ? '' : 's'}`;
}

/** e.g. `D major`. Falls back to the fifths count for a signature outside ±7. */
export function keySignatureName(key: KeySignature): string {
  const table = key.mode === 'minor' ? MINOR_KEYS : MAJOR_KEYS;
  const tonic = table[key.fifths];
  return tonic ? `${tonic} ${key.mode}` : `${key.fifths} fifths`;
}

/** Every key a picker should offer, from seven flats to seven sharps. */
export function keySignatureOptions(mode: KeySignature['mode']): Array<{
  fifths: number;
  label: string;
}> {
  const table = mode === 'minor' ? MINOR_KEYS : MAJOR_KEYS;
  return Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b)
    .map(fifths => ({
      fifths,
      label: `${table[fifths]} ${mode} — ${accidentalCountLabel(fifths)}`,
    }));
}

// ---- positions -------------------------------------------------------------

/**
 * Where `tick` falls, counted the way a player counts: bar 1 upwards, beat 1
 * upwards, with a fraction when it lands between beats.
 *
 * Read off the first track, since every track shares the measure grid once
 * `rebuildMeasureTicks` has run. `null` when the score has no measures, or the
 * tick lies past the end of them.
 */
export type BarBeat = { bar: number; beat: number };

export function barBeatForTick(score: Score, tick: number): BarBeat | null {
  const track = score.tracks[0];
  if (!track || track.measures.length === 0) return null;

  const measure = track.measures.find(
    m => tick >= m.startTick && tick < m.startTick + m.durationTicks
  );
  if (!measure) return null;

  const beatTicks = beatDurationTicks(
    measure.timeSignature as TimeSignature,
    score.ppq
  );
  /*
    Through `barNumberAt`, not `index + 1`: a pickup is not counted, so every
    bar after one is a bar lower than its position. The readout has to say the
    number the player's part says, or "go to bar 33" and the bar shown in the
    inspector mean two different places.

    A pickup itself has no number; it reports bar 0, which is what a player
    calls it when they have to call it something.
  */
  const index = track.measures.indexOf(measure);
  return {
    bar: barNumberAt(track.measures, index) ?? 0,
    beat: (tick - measure.startTick) / beatTicks + 1,
  };
}

/**
 * The tick at `bar`/`beat`, both counted from 1. `null` when that bar does not
 * exist; a beat past the end of its bar is clamped into it, because a typed
 * "beat 9" in 4/4 means the end of the bar rather than an error.
 */
export function tickForBarBeat(
  score: Score,
  bar: number,
  beat: number
): number | null {
  const track = score.tracks[0];
  if (!track) return null;
  // The inverse of the numbering above, so a typed bar number and a displayed
  // one always name the same bar.
  const index = indexOfBarNumber(track.measures, Math.round(bar));
  const measure = index === null ? undefined : track.measures[index];
  if (!measure) return null;

  const beatTicks = beatDurationTicks(
    measure.timeSignature as TimeSignature,
    score.ppq
  );
  const offset = Math.max(0, (beat - 1) * beatTicks);
  return measure.startTick + Math.min(offset, measure.durationTicks - 1);
}

// ---- staff positions -------------------------------------------------------

/**
 * The pitch printed on each clef's top staff line.
 *
 * Everything a click on the stave means is measured from here: a staff
 * position is a line or the space below it, and the pitch is that many
 * diatonic steps down from this note.
 *
 * Percussion has no pitch — a drum staff's lines are instruments, not notes —
 * so it borrows treble's geometry and the caller decides what a position means
 * on it.
 */
const TOP_LINE_PITCH: Record<Clef, Pitch> = {
  treble: { step: 'F', accidental: 0, octave: 5 },
  bass: { step: 'A', accidental: 0, octave: 3 },
  alto: { step: 'G', accidental: 0, octave: 4 },
  tenor: { step: 'E', accidental: 0, octave: 4 },
  percussion: { step: 'F', accidental: 0, octave: 5 },
};

/**
 * The pitch at a staff position, counted in half-spaces below the top line.
 *
 * `0` is the top line itself, `1` the space beneath it, `2` the next line down,
 * and negative values are ledger positions above. Diatonic throughout, because
 * a staff position names a letter rather than a semitone — what makes it an F♯
 * rather than an F is the key signature, which is applied elsewhere.
 */
export function pitchAtStavePosition(
  clef: Clef,
  positionsBelowTopLine: number
): Pitch {
  return shiftDiatonic(TOP_LINE_PITCH[clef], -positionsBelowTopLine);
}
