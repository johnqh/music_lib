/**
 * Picker options for the generation vocabularies: value, translated label, and
 * the order a reader scans them in.
 *
 * Both apps build the Style and Mood pickers, and both had written the same
 * three steps inline — sort the vocabulary on its translated label, map it to
 * `{ value, label }`, and pin a "none" entry on top — the web inside two
 * `useMemo`s, the native app as `styleSelectOptions`/`moodSelectOptions`. The
 * Replace forms on both sides skipped the steps entirely and showed the raw
 * values (`electroSwing`), so a Chinese reader chose a style in camel-case
 * English. One function is what stops the next picker doing the same.
 *
 * The label is a **function**, not a key prefix: the library holds no strings,
 * so the caller translates (`v => t(styleLabelKey(v))`), and a picker whose
 * labels are not locale entries at all can use it too.
 */
import { NO_MARK, sortOptionsByLabel } from '@sudobility/music_types';

/** One entry of a picker: the value it sets and the text it shows. */
export type LabelledOption<T extends string> = { value: T; label: string };

/**
 * The vocabulary as picker options, sorted on the label under `locale`.
 *
 * With `noneLabel`, a "none" entry is pinned above the sorted list with the
 * value `NO_MARK`: it is not a member of the vocabulary but its absence, and
 * sorting it among the styles would put "No style" somewhere between "New Age"
 * and "Pop". `NO_MARK` rather than `''` because a Radix select rejects an empty
 * item value; `optionalToPicker`/`optionalFromPicker` map a draft's `''` to and
 * from it.
 */
export function labelledOptions<T extends string>(
  values: readonly T[],
  label: (value: T) => string,
  locale?: string,
  noneLabel?: string
): LabelledOption<T | typeof NO_MARK>[] {
  const sorted = sortOptionsByLabel(values, label, locale).map(value => ({
    value,
    label: label(value),
  }));
  return noneLabel === undefined
    ? sorted
    : [{ value: NO_MARK, label: noneLabel }, ...sorted];
}

/** The locale key naming a generation style. */
export function styleLabelKey(style: string): string {
  return `generateScore.styleName.${style}`;
}

/** The locale key naming a generation mood. */
export function moodLabelKey(mood: string): string {
  return `generateScore.moodName.${mood}`;
}

/** The locale key naming a complexity level. */
export function complexityLabelKey(complexity: string): string {
  return `generateScore.complexityName.${complexity}`;
}

/** A draft's optional choice (`''` for none) as the value a picker holds. */
export function optionalToPicker(value: string): string {
  return value === '' ? NO_MARK : value;
}

/** A picker's value back as a draft's optional choice. */
export function optionalFromPicker(value: string): string {
  return value === NO_MARK ? '' : value;
}
