/**
 * Choosing the quantization grid a MIDI file actually needs.
 *
 * Import used to snap every file to a fixed sixteenth grid. That is
 * destructive for files that were already sequenced on another grid: an
 * eighth-note triplet sits at 1/3 of a beat, the nearest sixteenth is 1/4 or
 * 1/2, and the even triplet comes out as a limping dotted-sixteenth figure.
 * Measured on a 120bpm triplet line, every second and third note of each group
 * moved by 42ms. Swung eighths break the same way.
 * The notes are all still there, which is why this reads as "the timing is
 * wrong" rather than as anything missing.
 *
 * So: find the coarsest grid the file's own onsets already sit on, and use
 * that — quantizing to a grid the music is on cannot move anything. If nothing
 * fits, keep quantization off by default. A performance MIDI is already the
 * timing the listener expects, and snapping it is an editing choice, not a
 * safe default.
 */
import type { DurationName } from '@sudobility/music_types';

export type DetectedGrid = {
  grid: DurationName | null;
  /** Triplet subdivision of `grid` — 2/3 of it, matching `quantize`'s `tripletGrid`. */
  triplet: boolean;
};

/**
 * Candidates coarsest first, so the first fit wins: a file of straight eighths
 * should be described as eighths, not as the thirtysecond grid that also
 * happens to contain them. Both straight and triplet subdivisions are offered
 * at each level; the finest entry (1/12 beat) is the grid that contains both
 * sixteenths and eighth triplets, for files that use the two together.
 */
const CANDIDATES: Array<{ grid: DurationName; triplet: boolean; beats: number }> = [
  { grid: 'quarter', triplet: false, beats: 1 },
  { grid: 'quarter', triplet: true, beats: 2 / 3 },
  { grid: 'eighth', triplet: false, beats: 1 / 2 },
  { grid: 'eighth', triplet: true, beats: 1 / 3 },
  { grid: 'sixteenth', triplet: false, beats: 1 / 4 },
  { grid: 'sixteenth', triplet: true, beats: 1 / 6 },
  { grid: 'thirtysecond', triplet: false, beats: 1 / 8 },
  { grid: 'thirtysecond', triplet: true, beats: 1 / 12 },
];

/** No grid is assumed when the onsets fit nothing; preserve performance timing. */
export const FALLBACK_GRID: DetectedGrid = { grid: null, triplet: false };

/**
 * How far off a grid line an onset may sit and still count as on it, in beats.
 * ~10ms at 120bpm: wide enough for the tick-level rounding a sequencer leaves
 * behind, far too narrow to swallow played-by-hand timing.
 */
const TOLERANCE_BEATS = 0.02;

/**
 * The share of onsets that must fit. Not 100%: real files carry a few grace
 * notes, flams and hand-nudged accents, and one of those should not force the
 * whole file onto a finer grid than it is written on.
 */
const REQUIRED_FIT = 0.98;

function fits(onsetBeats: number[], gridBeats: number): boolean {
  let on = 0;
  for (const beat of onsetBeats) {
    const offset = Math.abs(beat / gridBeats - Math.round(beat / gridBeats)) * gridBeats;
    if (offset <= TOLERANCE_BEATS) on += 1;
  }
  return on / onsetBeats.length >= REQUIRED_FIT;
}

/**
 * The coarsest grid `positions` already sit on, or no grid when none does.
 * `ppq` is the file's own resolution — positions are compared in beats, so a
 * 960-ppq file and a 480-ppq one holding the same music detect alike.
 *
 * Callers pass note *ends* as well as onsets. The chosen grid quantizes
 * durations too, so a grid picked from onsets alone can still be too coarse to
 * express the file: a piece played in staccato quarters has quarter-note
 * onsets but eighth-note ends, and snapping those ends up to the quarter grid
 * would smear every note into the next and make the whole thing sound
 * sluggish. Feeding ends in makes the detector reject a grid that cannot hold
 * them.
 */
export function detectGrid(positions: number[], ppq: number): DetectedGrid {
  if (positions.length === 0 || ppq <= 0) return FALLBACK_GRID;
  const onsetBeats = positions.map((tick) => tick / ppq);
  const match = CANDIDATES.find((candidate) => fits(onsetBeats, candidate.beats));
  return match ? { grid: match.grid, triplet: match.triplet } : FALLBACK_GRID;
}
