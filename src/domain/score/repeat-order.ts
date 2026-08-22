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
import type { Measure, Score } from '@sudobility/music_types';

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
/**
 * Where a jump sends the player back to, and where it releases them.
 *
 * `from` is the bar the instruction sits on; `back` is the bar to resume at;
 * `stopAt` names what ends the second reading — `fine`, the `toCoda` bar, or
 * nothing at all for a plain D.C./D.S., which simply plays to the end.
 */
type JumpPlan = {
  back: number;
  stopAt: 'fine' | 'coda' | 'end';
};

/** The bar carrying `flag`, or `null`. The first one wins: a score with two segnos is malformed, and guessing between them is worse than taking the one a reader meets first. */
function findFlag(
  measures: readonly Measure[],
  flag: 'segno' | 'coda' | 'toCoda' | 'fine'
): number | null {
  const index = measures.findIndex(measure => measure[flag]);
  return index === -1 ? null : index;
}

/**
 * What `jump` means, resolved against the marks the score actually carries.
 *
 * A `dal segno` with no segno falls back to the start — which is what a reader
 * does with a broken score, and is better than refusing to play it. An `al
 * coda` with no coda plays to the end for the same reason.
 */
function planForJump(
  measures: readonly Measure[],
  jump: NonNullable<Measure['jump']>
): JumpPlan {
  const toSegno = jump.startsWith('dal-segno');
  const back = toSegno ? (findFlag(measures, 'segno') ?? 0) : 0;

  if (jump.endsWith('al-fine')) {
    return {
      back,
      stopAt: findFlag(measures, 'fine') === null ? 'end' : 'fine',
    };
  }
  if (jump.endsWith('al-coda')) {
    const hasCoda =
      findFlag(measures, 'coda') !== null &&
      findFlag(measures, 'toCoda') !== null;
    return { back, stopAt: hasCoda ? 'coda' : 'end' };
  }
  return { back, stopAt: 'end' };
}

export function repeatPlayOrder(score: Score): PlayedMeasure[] {
  const measures = score.tracks[0]?.measures ?? [];
  if (measures.length === 0) return [];

  const order: PlayedMeasure[] = [];
  const limit = measures.length * MAX_EXPANSION_FACTOR;

  /** How many times each backward repeat has sent us back. */
  const takenBack = new Map<number, number>();
  /**
   * Which jumps have already been obeyed.
   *
   * A D.C. is taken once: after the jump the player reads *through* it to the
   * end, or to the fine. Without this the piece never finishes.
   */
  const takenJumps = new Set<number>();
  /**
   * What ends the current reading, once a jump has been obeyed.
   *
   * `null` while reading normally. Set by a jump, and it is what makes
   * `fine` and `To Coda` mean nothing on the *first* pass — which is correct:
   * a player reads straight past both until sent back.
   */
  let stopAt: JumpPlan['stopAt'] | null = null;
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

    // `Fine` ends the piece, but only once a jump has sent us back past it —
    // on the way out it is read straight through.
    if (stopAt === 'fine' && measure.fine) break;

    // `To Coda` leaves for the closing section, likewise only after a jump.
    if (stopAt === 'coda' && measure.toCoda) {
      const coda = findFlag(measures, 'coda');
      if (coda !== null) {
        index = coda;
        stopAt = null;
        pass += 1;
        continue;
      }
    }

    // The jump itself, obeyed at the end of its bar and only once.
    if (measure.jump && !takenJumps.has(index)) {
      takenJumps.add(index);
      const plan = planForJump(measures, measure.jump);
      index = plan.back;
      sectionStart = plan.back;
      stopAt = plan.stopAt === 'end' ? null : plan.stopAt;
      pass += 1;
      continue;
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
