/**
 * What the duration selector shows, given the selection.
 *
 * One control replaced six toggle buttons, and it has to answer a different
 * question depending on what is selected:
 *
 * - **nothing selected** — the length the *next* note will be written at, which
 *   is the store's `snapGrid`. The control is an instruction about the future.
 * - **one note selected** — that note's length. The control is a readout.
 * - **several, all the same length** — that length; they agree, so there is an
 *   answer.
 * - **several of different lengths** — no single answer, so `mixed`. Not the
 *   first note's length, and not the armed length: either would claim the
 *   selection is something it is not, and picking that same value from the menu
 *   would then look like a no-op while silently rewriting every other note.
 *
 * Picking a value always applies to every selected note *and* arms it for the
 * next one, so the control never has to explain which of its two jobs it is
 * doing. Kept pure and separate from the toolbar so the four cases can be
 * tested without rendering one.
 */
import { durationNameForTicks } from '../../index.js';
import type { DurationName, NoteEvent } from '@sudobility/music_types';
import { durationParts } from '../time/duration-modifiers.js';
import type { BaseDuration } from '../time/duration-modifiers.js';

export type DurationDisplay =
  /** A single agreed duration: the selection's, or the armed one when nothing is selected. */
  | { kind: 'single'; duration: DurationName; base: BaseDuration }
  /** Selected notes disagree, or one of them is a length no name covers. */
  | { kind: 'mixed' };

/**
 * The duration to show for `notes`, falling back to `armed` when none are
 * selected.
 *
 * A note whose length matches no duration name (an imported or quantized note
 * of an odd tick count) counts as `mixed` rather than being rounded: the
 * control would otherwise offer to "keep" a value the note does not have.
 */
export function durationDisplay(
  notes: readonly NoteEvent[],
  ppq: number,
  armed: DurationName
): DurationDisplay {
  if (notes.length === 0) {
    return { kind: 'single', duration: armed, base: durationParts(armed).base };
  }

  let agreed: DurationName | null = null;
  for (const note of notes) {
    const name = durationNameForTicks(note.durationTicks, ppq);
    if (name === null) return { kind: 'mixed' };
    if (agreed === null) agreed = name;
    else if (agreed !== name) return { kind: 'mixed' };
  }

  return agreed === null
    ? { kind: 'mixed' }
    : { kind: 'single', duration: agreed, base: durationParts(agreed).base };
}
