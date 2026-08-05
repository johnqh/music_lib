/**
 * Collapsing runs of silence into multi-measure rests.
 *
 * Pure over a measure list — no score, no renderer — so the rules about what
 * counts as silent and where a run may not span are testable on their own.
 *
 * For **printed parts only**. A stored score always writes its rests out:
 * collapsing loses which bar is which, and the editor needs every bar.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type { Measure } from '@sudobility/music_types';

/** Below this, a run is written out — "1" over a bar is noise, not notation. */
const MIN_RUN = 2;

/**
 * Whether nothing sounds in `measure`.
 *
 * One note in any voice disqualifies it: the player still has to play that
 * bar, so it cannot disappear into a count.
 */
export function isSilentMeasure(measure: Measure): boolean {
  return measure.voices.every((voice) => !voice.events.some(isNoteEvent));
}

/** Whether a run may continue from `previous` into `next`. */
function runContinues(previous: Measure, next: Measure): boolean {
  // A mark inside a rest would be invisible, and "from B" would point at
  // nothing. The bar carrying it has to start its own rest.
  if (next.rehearsalMark !== undefined) return false;

  // A cue bar is written out: it is silent in the player's own voices, so
  // without this it would vanish into the count it exists to end.
  if (next.cue !== undefined) return false;

  // A multi-measure rest asserts the bars inside it are alike. Spanning a
  // change would hide from the player exactly where it happened.
  return (
    previous.timeSignature.numerator === next.timeSignature.numerator &&
    previous.timeSignature.denominator === next.timeSignature.denominator &&
    previous.keySignature.fifths === next.keySignature.fifths &&
    previous.keySignature.mode === next.keySignature.mode
  );
}

/**
 * `measures` with every run of two or more silent measures replaced by a
 * single measure carrying the count.
 *
 * The survivor is the run's **first** measure, keeping its own `index`,
 * `startTick` and signatures. That is what makes the numbering work: the
 * renderer draws measure numbers from `measure.index`, so the bar after a
 * 24-bar rest still reports 25.
 *
 * The returned list is therefore shorter than the input, and its measures are
 * no longer contiguous in `startTick`. Only a print-only derived score may
 * carry that.
 */
export function collapseRests(measures: readonly Measure[]): Measure[] {
  const out: Measure[] = [];
  let index = 0;

  while (index < measures.length) {
    const start = measures[index];

    // A cue bar may not *start* a run either, or a cue followed by more
    // silence would be collapsed away from the other end.
    if (!isSilentMeasure(start) || start.cue !== undefined) {
      out.push(start);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (
      end < measures.length &&
      isSilentMeasure(measures[end]) &&
      runContinues(measures[end - 1], measures[end])
    ) {
      end += 1;
    }

    const runLength = end - index;
    out.push(runLength >= MIN_RUN ? { ...start, multiMeasureRestCount: runLength } : start);
    index = end;
  }

  return out;
}
