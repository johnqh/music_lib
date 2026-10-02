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
import {
  NO_MARK,
  STYLE_FAMILIES,
  sortOptionsByLabel,
  stylesInFamily,
} from '@sudobility/music_types';
import type { LabelledOption, StyleFamily } from '@sudobility/music_types';

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

/** The locale key naming a style family, the picker's heading. */
export function styleFamilyLabelKey(family: string): string {
  return `generateScore.styleFamily.${family}`;
}

/** One heading of the style picker and the styles under it. */
export type StyleOptionGroup = {
  family: StyleFamily;
  label: string;
  options: LabelledOption<string>[];
};

/**
 * The style vocabulary grouped under its families (music_types'
 * `STYLE_FAMILY_OF`), for a picker that draws headings.
 *
 * Both levels are sorted on the label under `locale`, for the reason
 * `labelledOptions` sorts: declaration order is the order a table grew in, and
 * a family list in it is as hard to scan as the flat one was. The "none"
 * entry is not a member of any family, so it is the caller's to pin above.
 */
export function groupedStyleOptions(
  styleLabel: (style: string) => string,
  familyLabel: (family: StyleFamily) => string,
  locale?: string
): StyleOptionGroup[] {
  const groups = STYLE_FAMILIES.map(family => ({
    family,
    label: familyLabel(family),
    options: labelledOptions(stylesInFamily(family), styleLabel, locale),
  }));
  return [...groups].sort((a, b) => a.label.localeCompare(b.label, locale));
}

/**
 * The same picker flattened, for a select that draws no headings.
 *
 * Each entry carries its family in the label (`Jazz · Swing`), the way the
 * flat instrument menu carries its GM family, since the heading that would
 * have said so is gone; entries stay in grouped order, so a family's styles
 * sit together. With `noneLabel`, "none" is pinned on top as in
 * `labelledOptions`.
 */
export function flatStyleOptions(
  styleLabel: (style: string) => string,
  familyLabel: (family: StyleFamily) => string,
  locale?: string,
  noneLabel?: string
): LabelledOption<string>[] {
  const flat = groupedStyleOptions(styleLabel, familyLabel, locale).flatMap(
    group =>
      group.options.map(option => ({
        value: option.value,
        label: `${group.label} · ${option.label}`,
      }))
  );
  return noneLabel === undefined
    ? flat
    : [{ value: NO_MARK, label: noneLabel }, ...flat];
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
