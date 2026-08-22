/**
 * Composing and decomposing a `DurationName`.
 *
 * The model spells out all eighteen names — `quarter`, `dotted-quarter`,
 * `triplet-quarter` and so on — but a toolbar with eighteen buttons is
 * unreadable. The editor instead offers six base values and two modifiers,
 * which is how notation editors have always done it: pick the note, then dot
 * or tuplet it.
 *
 * Pure, so the composition rules are testable without a toolbar.
 */
import type { DurationName } from '@sudobility/music_types';

/** The six plain note values, longest first — the toolbar's row. */
export const BASE_DURATIONS = [
  'whole',
  'half',
  'quarter',
  'eighth',
  'sixteenth',
  'thirtysecond',
] as const;

export type BaseDuration = (typeof BASE_DURATIONS)[number];

/**
 * A duration split into the parts a toolbar shows.
 *
 * `dotted` and `triplet` are mutually exclusive, because the model has no name
 * for a dotted triplet — so the type cannot represent one either.
 */
export type DurationParts = {
  base: BaseDuration;
  modifier: 'none' | 'dotted' | 'triplet';
};

/** Splits a `DurationName` into its base value and modifier. */
export function durationParts(duration: DurationName): DurationParts {
  if (duration.startsWith('dotted-')) {
    return {
      base: duration.slice('dotted-'.length) as BaseDuration,
      modifier: 'dotted',
    };
  }
  if (duration.startsWith('triplet-')) {
    return {
      base: duration.slice('triplet-'.length) as BaseDuration,
      modifier: 'triplet',
    };
  }
  return { base: duration as BaseDuration, modifier: 'none' };
}

/** The `DurationName` for a base value and modifier. */
export function composeDuration(parts: DurationParts): DurationName {
  if (parts.modifier === 'none') return parts.base;
  return `${parts.modifier}-${parts.base}` as DurationName;
}

/**
 * `duration` with `modifier` applied, or stripped if it was already active.
 *
 * Toggling one modifier clears the other rather than stacking: there is no
 * dotted triplet in the model, and silently producing one of the two would be
 * worse than plainly replacing it.
 */
export function withModifier(
  duration: DurationName,
  modifier: 'dotted' | 'triplet'
): DurationName {
  const parts = durationParts(duration);
  return composeDuration({
    base: parts.base,
    modifier: parts.modifier === modifier ? 'none' : modifier,
  });
}

/** `duration` rebased onto a different note value, keeping its modifier. */
export function withBase(
  duration: DurationName,
  base: BaseDuration
): DurationName {
  return composeDuration({ base, modifier: durationParts(duration).modifier });
}
