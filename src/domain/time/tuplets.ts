/**
 * Finding the tuplets already written in a voice.
 *
 * A triplet is not a separate kind of object in this model — it is three notes
 * whose durations are each two thirds of a plain note value, which is exactly
 * what a triplet *is*. The toolbar has been able to write them since the
 * duration table gained `triplet-*`; what was missing was drawing the bracket
 * and the number, and saying so in MusicXML.
 *
 * Derived rather than stored, deliberately. A `tupletId` on each note would be
 * a second source of truth that every edit — delete one of the three, change
 * one's duration, paste over the middle — could leave inconsistent with the
 * durations themselves. Deriving it means a group that no longer sums to a
 * plain note value simply stops being drawn as one, which is the truth.
 */
import type { MusicalEvent } from '@sudobility/music_types';
import { durationNameForTicks } from './ticks.js';

/** A run of events forming one tuplet, as indices into the voice's event list. */
export type TupletGroup = {
  /** Index of the first event in the group. */
  start: number;
  /** How many events the group covers. */
  length: number;
  /** How many notes are played in the time of `normalNotes` — 3 for a triplet. */
  actualNotes: number;
  /** How many plain notes that time is worth — 2 for a triplet. */
  normalNotes: number;
};

/** Triplets are the only tuplet the duration table can express, so far. */
const TRIPLET_ACTUAL = 3;
const TRIPLET_NORMAL = 2;

/**
 * Every tuplet in `events`, in order.
 *
 * Groups runs of consecutive events that share the same triplet duration, in
 * threes. Three is what makes the group whole: three triplet-eighths occupy a
 * quarter, and a run of four would be one complete triplet plus a leftover
 * that is not yet a tuplet — drawing a bracket over it would claim a grouping
 * the music does not have.
 *
 * Rests count. A triplet with a rest in the middle is still a triplet, and
 * skipping them would join notes either side of it into a group that is not
 * one.
 */
export function tupletGroups(
  events: readonly MusicalEvent[],
  ppq: number
): TupletGroup[] {
  const groups: TupletGroup[] = [];
  let runStart = 0;
  let runName: string | null = null;
  let runLength = 0;

  const flush = (): void => {
    // Only whole threes; a trailing one or two are left ungrouped.
    for (let i = 0; i + TRIPLET_ACTUAL <= runLength; i += TRIPLET_ACTUAL) {
      groups.push({
        start: runStart + i,
        length: TRIPLET_ACTUAL,
        actualNotes: TRIPLET_ACTUAL,
        normalNotes: TRIPLET_NORMAL,
      });
    }
    runName = null;
    runLength = 0;
  };

  events.forEach((event, index) => {
    const name = durationNameForTicks(event.durationTicks, ppq);
    const isTriplet = name !== null && name.startsWith('triplet-');

    if (!isTriplet || name !== runName) {
      flush();
      if (!isTriplet) return;
      runStart = index;
      runName = name;
      runLength = 1;
      return;
    }
    runLength += 1;
  });
  flush();

  return groups;
}
