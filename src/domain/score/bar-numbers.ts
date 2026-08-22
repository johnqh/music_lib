/**
 * What number a bar is called.
 *
 * Almost always its position plus one — but a pickup is not counted, so a
 * score that opens with one has its first *full* bar as bar 1 and the pickup
 * as no number at all. That is not a display nicety: "go to bar 33" and the
 * inspector's Bar/Beat field have to mean the same 33 the player's part does,
 * and a score with a pickup shifts every one of them by one.
 *
 * Kept as a pure function over the measure list so the renderer, the go-to-bar
 * prompt and the inspector all answer identically without any of them knowing
 * how a pickup is stored.
 */
import type { Measure } from '@sudobility/music_types';

/**
 * The number printed over `measures[index]`, or `null` for a bar that is not
 * counted.
 *
 * `null` rather than 0: a pickup has no number, and printing one would claim
 * it does. The renderer draws nothing there, which is what an engraver does.
 */
export function barNumberAt(
  measures: readonly Measure[],
  index: number
): number | null {
  if (index < 0 || index >= measures.length) return null;
  if (measures[index].pickup) return null;

  let number = 0;
  for (let i = 0; i <= index; i += 1) {
    if (!measures[i].pickup) number += 1;
  }
  return number;
}

/**
 * The index of the bar a player would call `barNumber`.
 *
 * `null` when no such bar exists, so "go to bar 500" in a 40-bar score fails
 * rather than silently landing somewhere.
 */
export function indexOfBarNumber(
  measures: readonly Measure[],
  barNumber: number
): number | null {
  if (barNumber < 1) return null;
  let number = 0;
  for (let i = 0; i < measures.length; i += 1) {
    if (measures[i].pickup) continue;
    number += 1;
    if (number === barNumber) return i;
  }
  return null;
}

/**
 * Whether `measures` opens with a pickup.
 *
 * Only the first bar can be one — an anacrusis is the run-up to the first full
 * bar, and a short bar anywhere else is an irregular bar, which is a different
 * thing and keeps its number.
 */
export function hasPickup(measures: readonly Measure[]): boolean {
  return measures[0]?.pickup === true;
}
