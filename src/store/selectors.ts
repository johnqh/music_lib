/**
 * Derived-data selectors over `AppState` (spec §9, §10, §37.13): plain
 * `(state: AppState) => T` functions meant to be passed straight to
 * `useAppStore(selector)`, so a component only re-renders when the
 * specific derived value it reads actually changes (shallow-equal at the
 * leaf, not the whole store). Pure and read-only — no selector here
 * mutates the store or reaches outside `AppState`.
 *
 * The object/array-returning selectors below are memoized (single-slot,
 * reference-identity cache of their last inputs — the same strategy
 * `reselect` uses by default): calling one twice in a row with unchanged
 * inputs (e.g. `state.score`/`state.selection` unchanged) returns the
 * *same* array/object reference, not just a deep-equal one. This matters
 * because these are meant to be handed straight to `useAppStore(selector)`
 * — without reference stability, a component reading
 * `useAppStore(selectSelectedNotes)` would see a "new" array on every
 * store update (even ones that didn't touch selection/score) and
 * re-render every time.
 */
import { findEvent } from '../domain/score/queries.js';
import { selectionToRange } from '../domain/selection/selection.js';
import type { ScoreRange } from '../domain/selection/types.js';
import type { NoteEvent } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { beatDurationTicks } from '../domain/time/ticks.js';
import type { AppState } from './useAppStore.js';

/**
 * Builds a selector that recomputes only when either of its two tracked
 * inputs (compared with `Object.is`, i.e. by reference for
 * objects/arrays) has changed since the previous call. A single-slot
 * cache (not a multi-entry/keyed cache): fine for this codebase's usage
 * pattern of calling a given selector against one evolving store's
 * successive states, matching the standard `reselect`-style default.
 */
function memoize2<A, B, R>(
  getA: (state: AppState) => A,
  getB: (state: AppState) => B,
  compute: (a: A, b: B) => R
): (state: AppState) => R {
  let hasResult = false;
  let lastA: A;
  let lastB: B;
  let lastResult: R;

  return (state: AppState): R => {
    const a = getA(state);
    const b = getB(state);
    if (hasResult && Object.is(a, lastA) && Object.is(b, lastB)) {
      return lastResult;
    }
    lastA = a;
    lastB = b;
    lastResult = compute(a, b);
    hasResult = true;
    return lastResult;
  };
}

/** Every `NoteEvent` named by `state.selection.eventIds` that still resolves in `state.score` (rests and stale ids are skipped). Memoized on (`score`, `selection.eventIds`) reference identity. */
export const selectSelectedNotes = memoize2(
  state => state.score,
  state => state.selection.eventIds,
  (score, eventIds): NoteEvent[] => {
    if (!score) return [];
    return eventIds
      .map(id => findEvent(score, id))
      .filter(
        (event): event is NoteEvent => event !== null && isNoteEvent(event)
      );
  }
);

/** How many note events are currently selected (spec §9). A plain number, so no memoization of its own is needed beyond `selectSelectedNotes`'s. */
export function selectSelectedNoteCount(state: AppState): number {
  return selectSelectedNotes(state).length;
}

/** The current selection's tick/track span (spec §9's `ScoreRange`), aligned to full measures — `null` if the selection has no resolvable tick extent or there's no score loaded. Memoized on (`score`, `selection`) reference identity. */
export const selectSelectedMeasureRange = memoize2(
  state => state.score,
  state => state.selection,
  (score, selection): ScoreRange | null => {
    if (!score) return null;
    return selectionToRange(score, selection);
  }
);

export type MeasureBeat = { measureIndex: number; beat: number };

/**
 * The 1-based measure index and 1-based beat that `state.caretTick`
 * falls in (spec §10/§22, playback cursor), read off the score's first
 * track (every track shares the same measure grid once
 * `rebuildMeasureTicks` has run — see `domain/score/factory.ts`).
 * `null` if there's no score, or the score has no measures. Memoized on
 * (`score`, `caretTick`) reference/value identity.
 */
export const selectCurrentMeasureBeat = memoize2(
  state => state.score,
  state => state.caretTick,
  (score, caretTick): MeasureBeat | null => {
    if (!score) return null;
    const track = score.tracks[0];
    if (!track || track.measures.length === 0) return null;

    const measure =
      track.measures.find(
        m =>
          caretTick >= m.startTick && caretTick < m.startTick + m.durationTicks
      ) ?? track.measures[track.measures.length - 1];

    const beatTicks = beatDurationTicks(measure.timeSignature, score.ppq);
    const beat = Math.floor((caretTick - measure.startTick) / beatTicks) + 1;
    return { measureIndex: measure.index + 1, beat };
  }
);

/**
 * The tracks to draw, in score order.
 *
 * Falls back to every track when `visibleTrackIds` is null, or when nothing it
 * names still resolves against the score. That fallback is the whole point of
 * routing every consumer through here: a blank page is never a correct answer,
 * and this is the one place that has to be true.
 *
 * Filters the score's own id list rather than the stored one, so the result is
 * in score order regardless of the order the boxes were ticked.
 */
export const selectVisibleTrackIds = memoize2(
  state => state.score,
  state => state.visibleTrackIds,
  (score, visibleTrackIds): string[] => {
    if (!score || score.tracks.length === 0) return [];
    const all = score.tracks.map(t => t.id);
    if (!visibleTrackIds) return all;
    const wanted = new Set(visibleTrackIds);
    const kept = all.filter(id => wanted.has(id));
    return kept.length > 0 ? kept : all;
  }
);

/**
 * The effective active track id: the explicitly-set one when it still
 * resolves against the *visible* tracks, else the first visible track, else
 * `null` (no score, or a score with no tracks).
 *
 * Resolving here rather than reconciling `ui-slice.activeTrackId` on every
 * score change means "only one track, so it's active", "the active track was
 * just deleted" and "the active track was hidden" all fall out with no
 * subscription and no effect.
 *
 * Composed over `selectVisibleTrackIds` rather than reading `state.score`
 * directly: that selector is memoized, so its result is reference-stable and
 * serves as this one's memo input.
 */
export const selectActiveTrackId = memoize2(
  selectVisibleTrackIds,
  state => state.activeTrackId,
  (visibleIds, activeTrackId): string | null => {
    if (visibleIds.length === 0) return null;
    if (activeTrackId && visibleIds.includes(activeTrackId))
      return activeTrackId;
    return visibleIds[0];
  }
);
