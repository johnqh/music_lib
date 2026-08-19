/**
 * Regeneration workflow controller (spec §12): turns a score selection +
 * instruction into a structured `RegenerateRegionRequest` (extracting
 * preceding/selected/following context, expanding a partial-measure
 * selection to full measures), and turns an accepted candidate back into a
 * single undoable `ScoreCommand`.
 */
import { findTrack } from '../../domain/score/queries.js';
import type { Score } from '@sudobility/music_types';
import { selectionToRange } from '../../domain/selection/selection.js';
import type {
  ScoreRange,
  ScoreSelection,
} from '../../domain/selection/types.js';
import { extractFragment } from '../../domain/score/fragment.js';
import { replaceRegionCommand } from '../../domain/commands/region-commands.js';
import type { ScoreCommand } from '../../domain/commands/types.js';
import type {
  RegenerateRegionRequest,
  RegenerationCandidate,
  RegenerationConstraints,
} from '@sudobility/music_types';

/**
 * One, always. Generation is a background job now: nobody is present to pick
 * between alternatives when it lands, so a result that needed choosing would
 * leave the project in limbo.
 */
const CANDIDATE_COUNT = 1;
const CONTEXT_MEASURE_LIMIT = 2;

export type PrepareRegenerationOptions = {
  constraints?: Partial<
    Omit<
      RegenerationConstraints,
      'preserveMeasureCount' | 'preserveTimeSignatures' | 'preserveTempoEvents'
    >
  >;
  /** Same three dials whole-score generation has; the prompt builder emits them identically. */
  style?: string;
  mood?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
  /**
   * Whether `range` sits on measure boundaries. Drives `preserveMeasureCount`,
   * which says nothing about a sub-measure span and only muddies the prompt.
   * Defaults true because every caller except Replace Notes is aligned.
   */
  measureAligned?: boolean;
};

/**
 * `RegenerateRegionRequest` plus a flag reporting whether `selection` had
 * to be expanded to full-measure boundaries (spec §12: "partial-measure
 * regeneration may be converted internally into full-measure regeneration,
 * but the UI must explain this behavior"). Deliberately an intersection
 * (not a wrapper) so the result is usable anywhere a plain
 * `RegenerateRegionRequest` is expected.
 */
export type PreparedRegenerationRequest = RegenerateRegionRequest & {
  expandedToFullMeasures: boolean;
};

/**
 * The tick extent implied by `sel` *before* any measure-boundary
 * alignment — duplicates the first half of `selectionToRange`'s logic
 * (which always returns an already-aligned range) so this controller can
 * detect whether alignment actually changed anything.
 */
function rawTickExtent(
  score: Score,
  sel: ScoreSelection
): { start: number; end: number } | null {
  let min = Infinity;
  let max = -Infinity;

  for (const eventId of sel.eventIds) {
    const event = findEventTicks(score, eventId);
    if (!event) continue;
    min = Math.min(min, event.start);
    max = Math.max(max, event.end);
  }
  for (const measureId of sel.measureIds) {
    const measure = findMeasureTicks(score, measureId);
    if (!measure) continue;
    min = Math.min(min, measure.start);
    max = Math.max(max, measure.end);
  }
  if (sel.range) {
    min = Math.min(min, sel.range.startTick);
    max = Math.max(max, sel.range.endTick);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { start: min, end: max };
}

function findEventTicks(
  score: Score,
  eventId: string
): { start: number; end: number } | null {
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        const event = voice.events.find(e => e.id === eventId);
        if (event)
          return {
            start: event.startTick,
            end: event.startTick + event.durationTicks,
          };
      }
    }
  }
  return null;
}

function findMeasureTicks(
  score: Score,
  measureId: string
): { start: number; end: number } | null {
  for (const track of score.tracks) {
    const measure = track.measures.find(m => m.id === measureId);
    if (measure)
      return {
        start: measure.startTick,
        end: measure.startTick + measure.durationTicks,
      };
  }
  return null;
}

/** Up to `maxMeasures` measures immediately preceding `range.startTick`, unioned across `range`'s tracks (all tracks if `range.trackIds` is empty). */
function precedingContextRange(
  score: Score,
  range: ScoreRange,
  maxMeasures: number
): ScoreRange {
  const trackIds =
    range.trackIds.length > 0 ? range.trackIds : score.tracks.map(t => t.id);
  let earliestStart = range.startTick;

  for (const trackId of trackIds) {
    const track = findTrack(score, trackId);
    if (!track) continue;
    const priorMeasures = track.measures
      .filter(m => m.startTick < range.startTick)
      .slice(-maxMeasures);
    if (priorMeasures.length > 0) {
      earliestStart = Math.min(earliestStart, priorMeasures[0].startTick);
    }
  }

  return {
    startTick: earliestStart,
    endTick: range.startTick,
    trackIds: range.trackIds,
  };
}

/** Up to `maxMeasures` measures immediately following `range.endTick`, unioned across `range`'s tracks (all tracks if `range.trackIds` is empty). */
function followingContextRange(
  score: Score,
  range: ScoreRange,
  maxMeasures: number
): ScoreRange {
  const trackIds =
    range.trackIds.length > 0 ? range.trackIds : score.tracks.map(t => t.id);
  let latestEnd = range.endTick;

  for (const trackId of trackIds) {
    const track = findTrack(score, trackId);
    if (!track) continue;
    const nextMeasures = track.measures
      .filter(m => m.startTick >= range.endTick)
      .slice(0, maxMeasures);
    if (nextMeasures.length > 0) {
      const last = nextMeasures[nextMeasures.length - 1];
      latestEnd = Math.max(latestEnd, last.startTick + last.durationTicks);
    }
  }

  return {
    startTick: range.endTick,
    endTick: latestEnd,
    trackIds: range.trackIds,
  };
}

/**
 * Builds a `RegenerateRegionRequest` for `selection` on `score`: aligns the
 * selection to full-measure boundaries (`selectionToRange` always does
 * this; `expandedToFullMeasures` reports whether that changed anything),
 * and extracts up to 2 measures of preceding/following context alongside
 * the selected fragment itself (spec §12 steps 1-3).
 *
 * Throws if `selection` has no resolvable tick range (nothing selected).
 */
export function prepareRegenerationRequest(
  score: Score,
  selection: ScoreSelection,
  instruction: string,
  options: PrepareRegenerationOptions = {}
): PreparedRegenerationRequest {
  const alignedRange = selectionToRange(score, selection);
  if (!alignedRange) {
    throw new Error(
      'prepareRegenerationRequest: selection has no resolvable tick range.'
    );
  }

  const raw = rawTickExtent(score, selection);
  const expandedToFullMeasures =
    raw !== null &&
    (raw.start !== alignedRange.startTick || raw.end !== alignedRange.endTick);

  // `selectionToRange` has already aligned, so the region below is aligned by
  // construction — hence the explicit `true` rather than trusting the default.
  return {
    ...prepareRegenerationRequestForRange(score, alignedRange, instruction, {
      ...options,
      measureAligned: true,
    }),
    expandedToFullMeasures,
  };
}

/**
 * Builds a request for an explicit tick range, used **verbatim**.
 *
 * This is the entry point Replace Notes needs. `prepareRegenerationRequest`
 * snaps its selection out to whole measures, which is exactly what "replace
 * only these notes" forbids; the snapping policy lives there alone so it
 * cannot be half-applied here.
 *
 * `expandedToFullMeasures` is always false: nothing was expanded, because
 * nothing was derived — the caller said what it meant.
 */
export function prepareRegenerationRequestForRange(
  score: Score,
  range: ScoreRange,
  instruction: string,
  options: PrepareRegenerationOptions = {}
): PreparedRegenerationRequest {
  const selectedFragment = extractFragment(score, range);
  const precedingContext = extractFragment(
    score,
    precedingContextRange(score, range, CONTEXT_MEASURE_LIMIT)
  );
  const followingContext = extractFragment(
    score,
    followingContextRange(score, range, CONTEXT_MEASURE_LIMIT)
  );

  const constraints: RegenerationConstraints = {
    // Omitted, not false, when the region does not sit on barlines: there is
    // no measure count to preserve, and asserting one confuses the prompt.
    ...((options.measureAligned ?? true)
      ? { preserveMeasureCount: true as const }
      : {}),
    preserveTimeSignatures: true,
    preserveTempoEvents: true,
    ...options.constraints,
  };

  return {
    scoreId: score.id,
    instruction,
    range,
    precedingContext,
    selectedFragment,
    followingContext,
    constraints,
    candidateCount: CANDIDATE_COUNT,
    ...(options.style ? { style: options.style } : {}),
    ...(options.mood ? { mood: options.mood } : {}),
    ...(options.complexity ? { complexity: options.complexity } : {}),
    expandedToFullMeasures: false,
  };
}

/**
 * Turns an accepted regeneration `candidate` into the single undoable
 * `ScoreCommand` that replaces the region with the candidate's fragment
 * (spec §12 steps 10-13). `score` is used defensively, to confirm every
 * track the candidate references still exists before building the command
 * (a candidate produced against a since-edited score could reference a
 * deleted track).
 */
export function applyCandidate(
  score: Score,
  candidate: RegenerationCandidate
): ScoreCommand {
  const { range } = candidate.fragment;
  const missingTrackId = range.trackIds.find(
    id => findTrack(score, id) === null
  );
  if (missingTrackId) {
    throw new Error(
      `applyCandidate: candidate references track "${missingTrackId}", which is not present in the score.`
    );
  }
  return replaceRegionCommand(range, candidate.fragment);
}
