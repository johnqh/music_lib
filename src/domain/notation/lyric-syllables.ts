/**
 * How a typed syllable joins its neighbours.
 *
 * Its own module rather than living beside the entry bar: it is a pure rule
 * about words, the entry bar is a component, and keeping them together costs
 * that file its fast refresh.
 */
import type { Syllabic } from '@sudobility/music_types';

/**
 * Derived from whether the writer hyphenated this syllable and whether they
 * hyphenated the one before — a writer knows they are in the middle of
 * "beau-ti-ful" and should not also have to say so.
 */
export function syllabicFor(
  previousHyphenated: boolean,
  hyphenated: boolean
): Syllabic {
  if (previousHyphenated && hyphenated) return 'middle';
  if (previousHyphenated) return 'end';
  if (hyphenated) return 'begin';
  return 'single';
}
