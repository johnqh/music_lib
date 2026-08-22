/**
 * Turning a key tap into a written note.
 *
 * Pure — no DOM, no store, no audio — so the timing maths is unit-testable, in
 * the same shape as the editor's other geometry modules.
 */
import type { DurationName } from '@sudobility/music_types';

/**
 * The durations a tap can land on, longest first, with their length as a
 * fraction of a whole note.
 *
 * Stops at a thirty-second because that is what the duration toolbar offers:
 * a tap cannot produce something the buttons cannot.
 */
const CANDIDATES: ReadonlyArray<{ name: DurationName; whole: number }> = [
  { name: 'whole', whole: 1 },
  { name: 'half', whole: 1 / 2 },
  { name: 'quarter', whole: 1 / 4 },
  { name: 'eighth', whole: 1 / 8 },
  { name: 'sixteenth', whole: 1 / 16 },
  { name: 'thirtysecond', whole: 1 / 32 },
];

/**
 * The written duration closest to a tap of `heldMs` at `bpm`.
 *
 * Matched on a *ratio*, not a difference: a 40ms overshoot is nothing against a
 * whole note and everything against a thirty-second, and comparing absolute
 * error would push almost every tap toward the longest value. Comparing
 * `log(actual / candidate)` treats being 20% long the same at every duration,
 * which is how a player experiences it.
 *
 * A tap shorter than the briefest candidate returns that candidate rather than
 * nothing: someone stabbing at a key means the shortest note, not no note.
 */
export function durationForTap(heldMs: number, bpm: number): DurationName {
  const safeBpm = bpm > 0 ? bpm : 120;
  const wholeNoteMs = (60_000 / safeBpm) * 4;
  const held = Math.max(1, heldMs) / wholeNoteMs;

  let best = CANDIDATES[CANDIDATES.length - 1];
  let bestError = Number.POSITIVE_INFINITY;
  for (const candidate of CANDIDATES) {
    const error = Math.abs(Math.log(held / candidate.whole));
    if (error < bestError) {
      bestError = error;
      best = candidate;
    }
  }
  return best.name;
}
