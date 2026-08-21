/**
 * The order a score's bars are actually played in.
 *
 * Written order and played order are the same thing until a repeat exists, and
 * different afterwards: bar 3 may be played twice, and a first ending is
 * skipped on the second pass. Everything about repeats in playback comes from
 * this one list.
 *
 * Kept as a pure function over the score so it can be tested without an engine,
 * and so the *plan* is the only thing that ever sees expanded time — the score
 * itself stays the canonical, written thing.
 */
import type { Score } from '@sudobility/music_types';

/** One bar as played, and which pass through the repeat it belongs to. */
export type PlayedMeasure = {
  measureIndex: number;
  /** 1 on the first time through a section, 2 on the second, and so on. */
  pass: number;
};

/**
 * A guard against a score that would never finish.
 *
 * Malformed nesting — a backward repeat that jumps behind another one that has
 * already been satisfied — can otherwise loop forever. Ten times the bar count
 * is far beyond any real piece and stops the editor hanging on a bad import.
 */
const MAX_EXPANSION_FACTOR = 10;

/**
 * Whether a bar is played on `pass`.
 *
 * A bar with no ending numbers is played on every pass — most bars. One inside
 * a volta is played only on the passes it names.
 */
function playedOnPass(
  endingNumbers: number[] | undefined,
  pass: number
): boolean {
  if (!endingNumbers || endingNumbers.length === 0) return true;
  return endingNumbers.includes(pass);
}

/**
 * Expands `score` into the sequence of bars a player would perform.
 *
 * The algorithm is the one a player follows: read forward; at a `:|` jump back
 * to the most recent `|:` (or to the start, if there is none — a `:|` alone
 * means "repeat from the beginning") and read forward again on the next pass,
 * skipping the bars whose volta does not name it. A section is only taken back
 * once, which is what `2` in a second ending means.
 *
 * A score with no repeats returns its bars in order, once each — so playback of
 * an unrepeated score is byte-identical to what it was before repeats existed.
 */
export function repeatPlayOrder(score: Score): PlayedMeasure[] {
  const measures = score.tracks[0]?.measures ?? [];
  if (measures.length === 0) return [];

  const order: PlayedMeasure[] = [];
  const limit = measures.length * MAX_EXPANSION_FACTOR;

  /** How many times each backward repeat has sent us back. */
  const takenBack = new Map<number, number>();
  let index = 0;
  let sectionStart = 0;
  let pass = 1;

  while (index < measures.length && order.length < limit) {
    const measure = measures[index];

    if (measure.repeatStart && index !== sectionStart) {
      // A new section begins here, so passes restart with it.
      sectionStart = index;
      pass = 1;
    }

    if (playedOnPass(measure.endingNumbers, pass)) {
      order.push({ measureIndex: index, pass });
    }

    if (measure.repeatEnd) {
      const taken = takenBack.get(index) ?? 0;
      // Once only: a plain `:|` means play the section twice, and the second
      // time through it is read past rather than obeyed again.
      if (taken < 1) {
        takenBack.set(index, taken + 1);
        pass += 1;
        index = sectionStart;
        continue;
      }
    }

    index += 1;
  }

  return order;
}
