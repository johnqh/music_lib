/**
 * Selection helpers (spec §9). Pure, read-only functions over `Score` +
 * `ScoreSelection`/`ScoreRange` — no UI, store, or rendering concerns.
 */
import {
  findEvent,
  findMeasure,
  findTrack,
  scoreEndTick,
} from '../score/queries.js';
import type { Score, Track } from '@sudobility/music_types';
import type { ScoreRange, ScoreSelection } from './types.js';

/**
 * The smallest tick range, aligned to full-measure boundaries on every
 * implicated track, that covers everything named by `sel` (selected
 * events, measures, an explicit `range`, and/or `trackIds`). Returns
 * `null` when the selection carries no tick information at all (no
 * resolvable events, no resolvable measures, and no `range`) — a bare
 * `trackIds` selection has no timeline extent to convert.
 *
 * Track scope for the result is the union of: `sel.trackIds`, the owning
 * track of every resolved event/measure, and `sel.range?.trackIds`. An
 * id that doesn't resolve to anything in `score` (stale selection) is
 * simply skipped when gathering tick anchors, but is still carried
 * through into the result's `trackIds` (see `selectionIsRegenerable`,
 * which treats that as a disqualifying condition).
 */
export function selectionToRange(
  score: Score,
  sel: ScoreSelection
): ScoreRange | null {
  let minTick = Infinity;
  let maxTick = -Infinity;
  const trackIds = new Set<string>();

  for (const eventId of sel.eventIds) {
    const event = findEvent(score, eventId);
    if (!event) continue;
    minTick = Math.min(minTick, event.startTick);
    maxTick = Math.max(maxTick, event.startTick + event.durationTicks);
    trackIds.add(event.trackId);
  }

  for (const measureId of sel.measureIds) {
    const measure = findMeasure(score, measureId);
    if (!measure) continue;
    minTick = Math.min(minTick, measure.startTick);
    maxTick = Math.max(maxTick, measure.startTick + measure.durationTicks);
    const owningTrack = score.tracks.find(t =>
      t.measures.some(m => m.id === measureId)
    );
    if (owningTrack) trackIds.add(owningTrack.id);
  }

  if (sel.range) {
    minTick = Math.min(minTick, sel.range.startTick);
    maxTick = Math.max(maxTick, sel.range.endTick);
    for (const id of sel.range.trackIds) trackIds.add(id);
  }

  for (const id of sel.trackIds) trackIds.add(id);

  if (!Number.isFinite(minTick) || !Number.isFinite(maxTick)) {
    return null;
  }

  const scopedTrackIds = [...trackIds];
  const tracksInScope: Track[] =
    scopedTrackIds.length > 0
      ? scopedTrackIds
          .map(id => findTrack(score, id))
          .filter((t): t is Track => t !== null)
      : score.tracks;

  let alignedStart = minTick;
  let alignedEnd = maxTick;
  for (const track of tracksInScope) {
    for (const measure of track.measures) {
      const measureEnd = measure.startTick + measure.durationTicks;
      if (measure.startTick < maxTick && measureEnd > minTick) {
        alignedStart = Math.min(alignedStart, measure.startTick);
        alignedEnd = Math.max(alignedEnd, measureEnd);
      }
    }
  }

  return {
    startTick: alignedStart,
    endTick: alignedEnd,
    trackIds: scopedTrackIds,
  };
}

/** Deduplicates an array while preserving first-seen order. */
function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Returns a selection with: duplicate ids removed; event/measure/track ids
 * that no longer resolve in `score` dropped (a stale reference left over
 * from an edit that deleted the selected object); and, if present, `range`
 * normalized (its own `trackIds` deduplicated, and `startTick`/`endTick`
 * swapped into ascending order if given reversed).
 */
export function normalizeSelection(
  score: Score,
  sel: ScoreSelection
): ScoreSelection {
  const eventIds = dedupe(sel.eventIds).filter(
    id => findEvent(score, id) !== null
  );
  const measureIds = dedupe(sel.measureIds).filter(
    id => findMeasure(score, id) !== null
  );
  const trackIds = dedupe(sel.trackIds).filter(
    id => findTrack(score, id) !== null
  );

  const normalized: ScoreSelection = { eventIds, measureIds, trackIds };

  if (sel.range) {
    const startTick = Math.max(
      0,
      Math.min(sel.range.startTick, sel.range.endTick)
    );
    const endTick = Math.max(sel.range.startTick, sel.range.endTick);
    normalized.range = {
      startTick,
      endTick,
      trackIds: dedupe(sel.range.trackIds),
    };
  }

  return normalized;
}

/**
 * Whether `sel` can be converted (via `selectionToRange`) into a valid
 * regeneration region: a non-empty, nonnegative tick span that doesn't
 * extend past the end of the score, on tracks that all actually exist.
 */
export function selectionIsRegenerable(
  score: Score,
  sel: ScoreSelection
): boolean {
  const range = selectionToRange(score, sel);
  if (!range) return false;
  if (range.startTick < 0 || range.startTick >= range.endTick) return false;
  if (range.endTick > scoreEndTick(score)) return false;
  return range.trackIds.every(id => findTrack(score, id) !== null);
}

/**
 * A short, human-readable summary of what's selected (e.g. "3 note(s)
 * selected"), checked in the same priority order `selectionToRange`
 * resolves tick anchors in (events, then measures, then bare tracks).
 * Spec §27: screen-reader text summarizing the current selection, shared
 * between `AppLayout`'s status bar and the score-editor/piano-roll
 * containers' own SR-only summaries (`ScoreEditorView`/`PianoRollView`) so
 * all three always agree on the same wording.
 *
 * `regenerated` appends ", regenerated". Note state is carried by color
 * alone on the canvas now (the highlight overlay's solid/dashed/dotted
 * stroke patterns went away with it), so this label is the non-color
 * channel keeping that state perceivable — not a cosmetic extra.
 */
/**
 * The words this summary is built from, supplied by the caller.
 *
 * Functions rather than strings because the counts have to agree with their
 * nouns, and which forms a number takes is a property of the language, not of
 * a selection — English has two, Chinese one, Polish three.
 */
export type SelectionSummaryCopy = {
  notes: (count: number) => string;
  measures: (count: number) => string;
  tracks: (count: number) => string;
  none: string;
  /** Wraps a summary to say it describes regenerated music. */
  regenerated: (summary: string) => string;
};

export function selectionSummaryLabel(
  sel: ScoreSelection,
  copy: SelectionSummaryCopy,
  regenerated = false
): string {
  const mark = (summary: string) =>
    regenerated ? copy.regenerated(summary) : summary;
  if (sel.eventIds.length > 0) return mark(copy.notes(sel.eventIds.length));
  if (sel.measureIds.length > 0)
    return mark(copy.measures(sel.measureIds.length));
  if (sel.trackIds.length > 0) return mark(copy.tracks(sel.trackIds.length));
  return copy.none;
}
