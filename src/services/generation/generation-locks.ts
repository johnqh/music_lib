/**
 * Generate Again, keeping the choices somebody liked.
 *
 * The server rolls a groove, a chord cycle, a hook, an arrangement, a
 * signature moment, a tune carrier and a lyric approach for every piece, so two
 * generations of one request are two pieces. The web editor shows each choice
 * with a lock, and generating again sends the same request with the locked
 * choices kept and the rest re-rolled. The native app is gaining the same
 * control, and the rules — which choices are lockable, in what order, how the
 * carrier is shown and what a lock sends — were all inside the web component.
 * They are here so the two panels cannot lock different things.
 */
import type {
  GenerateScoreRequest,
  GenerationChoices,
  GenerationRecord,
} from '@sudobility/music_types';
import { estimateGenerateScoreCredits } from './request.js';

/** The choices a reader can lock, in the order they are shown. */
export const LOCKABLE = [
  'groove',
  'cycle',
  'arcEntry',
  'arcIntensity',
  'moment',
  'carrier',
  'formShape',
  'hook',
  'lyric',
] as const;

export type LockableChoice = (typeof LOCKABLE)[number];

/**
 * What a choice reads as, or `null` when the server made none.
 *
 * The carrier is stored as an index into the request's tracks — which is what
 * a lock must send back — and shown by the track's name, which is what a
 * reader recognises.
 */
export function lockableChoiceValue(
  choices: GenerationChoices,
  key: LockableChoice
): string | null {
  if (key === 'carrier') return choices.carrierName;
  const value = choices[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The rows a lock panel shows: the lockable choices this generation actually
 * made. A lock on a choice the server never rolled would keep nothing.
 */
export function lockableChoiceRows(record: GenerationRecord): LockableChoice[] {
  return LOCKABLE.filter(
    key => lockableChoiceValue(record.choices, key) !== null
  );
}

/** The locale key naming a lockable choice. */
export function generationChoiceLabelKey(key: LockableChoice): string {
  return `generationChoices.${key}`;
}

/**
 * The request Generate Again sends: the same request, with **only** the locked
 * choices pinned.
 *
 * The request's own `choices` are replaced, not merged: a request that was
 * itself a Generate Again carries the locks of that earlier run, and keeping
 * one the reader has since unlocked would pin something they just asked to
 * change. The carrier locks by its index, because that is what the server
 * reads.
 */
export function regenerateWithLocks(
  record: GenerationRecord,
  lockedKeys: Iterable<LockableChoice>
): GenerateScoreRequest {
  const locks: Partial<GenerationChoices> = {};
  for (const key of lockedKeys) {
    if (key === 'carrier') locks.carrier = record.choices.carrier;
    else (locks as Record<string, unknown>)[key] = record.choices[key];
  }
  return { ...record.request, choices: locks };
}

/**
 * What generating again is quoted at: the same request, so the same bill — its
 * bars times its tracks.
 */
export function regenerateCreditEstimate(record: GenerationRecord): number {
  return estimateGenerateScoreCredits(
    record.request.durationMeasures,
    record.request.tracks.length
  );
}
