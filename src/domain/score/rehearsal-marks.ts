/**
 * Where rehearsal marks go, and what they are called.
 *
 * **Derived from the whole score, once.** A mark is only useful if it means
 * the same bar in every part — the conductor says "from B" and everyone finds
 * the same place. Deriving per-part would give each player different letters,
 * which is worse than no marks at all.
 *
 * Print-only: a stored score carries none, and the editor never shows them.
 */
import { isSilentMeasure } from './collapse-rests.js';
import type { Measure, Score } from '@sudobility/music_types';

/** A mark every this many bars through a stretch with no other structure. */
const REGULAR_INTERVAL = 16;

/**
 * Closest two marks may be.
 *
 * Without a floor, a passage that changes metre twice in three bars gets three
 * marks and none of them helps.
 */
const MIN_SPACING = 4;

/** A silence at least this long counts as structural — the same threshold that collapses a rest. */
const LONG_SILENCE = 2;

/**
 * The label for the `ordinal`-th mark: A…Z, then AA, BB, CC.
 *
 * Doubled rather than paired: "AB" spoken over a bad line sounds like two
 * separate marks, while "double A" cannot be mistaken for anything else.
 */
export function markLabel(ordinal: number): string {
  const letter = String.fromCharCode(65 + (ordinal % 26));
  const repeats = Math.floor(ordinal / 26) + 1;
  return letter.repeat(repeats);
}

/** Whether `index` starts a stretch of silence at least `LONG_SILENCE` bars long, in `track`. */
function silenceRunLength(measures: readonly Measure[], index: number): number {
  let length = 0;
  while (index + length < measures.length && isSilentMeasure(measures[index + length])) {
    length += 1;
  }
  return length;
}

/**
 * Measure indices that deserve a mark, before spacing is applied.
 *
 * Structural signals first — a change of key or metre, and the bar where
 * somebody re-enters after a long rest — then a regular interval so a long
 * unbroken stretch is not left without a landmark.
 */
function candidates(score: Score): number[] {
  const reference = score.tracks[0]?.measures ?? [];
  const found = new Set<number>();

  for (let index = 1; index < reference.length; index += 1) {
    const previous = reference[index - 1];
    const measure = reference[index];

    const metreChanged =
      previous.timeSignature.numerator !== measure.timeSignature.numerator ||
      previous.timeSignature.denominator !== measure.timeSignature.denominator;
    const keyChanged =
      previous.keySignature.fifths !== measure.keySignature.fifths ||
      previous.keySignature.mode !== measure.keySignature.mode;

    if (metreChanged || keyChanged) found.add(index);
    if (index % REGULAR_INTERVAL === 0) found.add(index);
  }

  // An entrance after a long rest, in ANY track: a mark is a landmark for
  // everybody, and the second oboe re-entering is as structural as the first
  // violin doing so.
  for (const track of score.tracks) {
    for (let index = 0; index < track.measures.length; index += 1) {
      const run = silenceRunLength(track.measures, index);
      if (run >= LONG_SILENCE) {
        const entrance = index + run;
        if (entrance > 0 && entrance < track.measures.length) found.add(entrance);
        index += run - 1;
      }
    }
  }

  // Bar 1 never gets one: "from the top" already exists.
  found.delete(0);
  return [...found].sort((a, b) => a - b);
}

/**
 * Marks for `score`, keyed by measure index.
 *
 * Candidates closer together than `MIN_SPACING` are thinned, earlier winning:
 * a mark just after a change is more useful than one just before the next.
 */
export function rehearsalMarks(score: Score): Map<number, string> {
  const kept: number[] = [];
  for (const index of candidates(score)) {
    const previous = kept[kept.length - 1];
    if (previous === undefined || index - previous >= MIN_SPACING) kept.push(index);
  }

  return new Map(kept.map((index, ordinal) => [index, markLabel(ordinal)]));
}

/**
 * `measures` with each mark written onto the measure carrying that **index**.
 *
 * Keyed by `measure.index`, not array position: a part's measures have already
 * been thinned by rest-collapsing, so position means nothing.
 */
export function applyRehearsalMarks(
  measures: readonly Measure[],
  marks: ReadonlyMap<number, string>,
): Measure[] {
  return measures.map((measure) => {
    const mark = marks.get(measure.index);
    return mark === undefined ? measure : { ...measure, rehearsalMark: mark };
  });
}

/**
 * `score` with rehearsal marks on every track.
 *
 * For the whole-score print. Every track gets the same letters at the same
 * bars, which is the only way "from B" can mean anything.
 */
export function withRehearsalMarks(score: Score): Score {
  const marks = rehearsalMarks(score);
  return {
    ...score,
    tracks: score.tracks.map((track) => ({
      ...track,
      measures: applyRehearsalMarks(track.measures, marks),
    })),
  };
}
