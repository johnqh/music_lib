/**
 * Validates and repairs an AI-generated score response before it's trusted
 * anywhere in the app (spec §11: "validate responses with Zod; validate
 * musical structure; ... normalize IDs; normalize tick positions; repair
 * minor structural issues where safe; report unrepairable errors clearly").
 *
 * `sanitizeGeneratedScore(score: unknown)` is the brief's exact minimum
 * signature. It also accepts an optional second `context` parameter (never
 * required by a caller matching that minimal signature) carrying the
 * per-track pitch-range/max-polyphony constraints a `GenerateScoreRequest`
 * or regeneration's `constraints` may have specified — those constraints
 * live outside the `Score` JSON itself, so there's no way to check "out of
 * range notes when range given" or "overlapping monophonic notes when
 * maximumPolyphony===1" without a caller supplying them out of band.
 */
import { scoreSchema } from '@sudobility/music_types';
import { createId } from '../../domain/score/ids';
import { rebuildMeasureTicks } from '../../domain/score/factory';
import type { Measure, MusicalEvent, Score } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { pitchToMidi } from '../../domain/pitch/pitch';
import { measureDurationTicks } from '../../domain/time/ticks';
import { regenerateRegionResultSchema } from '@sudobility/music_types';
import type { RegenerateRegionResult } from '@sudobility/music_types';

/** Thrown when a generated score has a problem `sanitizeGeneratedScore` cannot safely repair. */
export class GenerationValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Generated score has unrepairable issue(s): ${issues.join('; ')}`);
    this.name = 'GenerationValidationError';
    this.issues = issues;
  }
}

export type SanitizeTrackContext = {
  range?: { lowestMidi: number; highestMidi: number };
  maximumPolyphony?: number;
};

/** Per-track constraints, matched to `score.tracks` by array position (index i <-> tracks[i]). */
export type SanitizeContext = {
  tracks?: SanitizeTrackContext[];
};

/** Total ticks covered by a set of events, merging overlapping/touching spans so simultaneous notes (chords) aren't double-counted. */
function coveredTicks(events: Array<{ startTick: number; durationTicks: number }>): number {
  const spans = events
    .map((e) => ({ start: e.startTick, end: e.startTick + e.durationTicks }))
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let i = 0;
  while (i < spans.length) {
    let end = spans[i].end;
    let j = i + 1;
    while (j < spans.length && spans[j].start <= end) {
      end = Math.max(end, spans[j].end);
      j += 1;
    }
    total += end - spans[i].start;
    i = j;
  }
  return total;
}

/** Fills every gap in `sortedEvents` (including a leading gap from the measure start and a trailing gap to the measure end) with a `RestEvent`. */
function padUnderfullVoice(
  sortedEvents: MusicalEvent[],
  measure: Measure,
  voiceId: string,
  trackId: string,
): MusicalEvent[] {
  const result: MusicalEvent[] = [];
  let cursor = measure.startTick;

  for (const event of sortedEvents) {
    if (event.startTick > cursor) {
      result.push({ id: createId(), startTick: cursor, durationTicks: event.startTick - cursor, voiceId, trackId });
    }
    result.push(event);
    cursor = Math.max(cursor, event.startTick + event.durationTicks);
  }

  const measureEnd = measure.startTick + measure.durationTicks;
  if (cursor < measureEnd) {
    result.push({ id: createId(), startTick: cursor, durationTicks: measureEnd - cursor, voiceId, trackId });
  }
  return result;
}

/** Whether two events' `[startTick, startTick + durationTicks)` spans overlap. */
function eventsOverlap(a: { startTick: number; durationTicks: number }, b: { startTick: number; durationTicks: number }): boolean {
  return a.startTick < b.startTick + b.durationTicks && b.startTick < a.startTick + a.durationTicks;
}

/**
 * Validates `score` (untrusted JSON) against the score schema, then
 * normalizes and repairs it:
 *
 * 1. Zod-parses the shape (throws `GenerationValidationError` if it
 *    doesn't even match the `Score` schema).
 * 2. Regenerates every id (score/tempo/track/measure/voice/event) via
 *    `createId()` and re-links `trackId`/`voiceId` references — an AI
 *    response's ids are never trusted for uniqueness.
 * 3. Rejects (unrepairable) any event with a non-positive duration.
 * 4. Normalizes tick positions to the measure grid: recomputes each
 *    measure's `durationTicks` from its own `timeSignature` and
 *    `index`/`startTick` from array order (via `rebuildMeasureTicks`).
 * 5. Repairs underfull voices (covered ticks < measure duration) by
 *    padding gaps with rests.
 * 6. Rejects (unrepairable) overfull measures, notes outside
 *    `context.tracks[i].range` (when given), and overlapping notes in a
 *    voice whose track has `context.tracks[i].maximumPolyphony === 1`.
 *
 * Returns the repaired `Score` plus a list of warnings describing what was
 * normalized/repaired; throws `GenerationValidationError` (with every
 * unrepairable issue found, not just the first) if step 3 or step 6 finds
 * something it cannot safely fix.
 */
export function sanitizeGeneratedScore(
  score: unknown,
  context: SanitizeContext = {},
): { score: Score; warnings: string[] } {
  const warnings: string[] = [];

  const parseResult = scoreSchema.safeParse(score);
  if (!parseResult.success) {
    throw new GenerationValidationError(parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  let parsed = parseResult.data as Score;

  // ---- Regenerate all ids, then re-link trackId/voiceId to the fresh ones ----
  const idMap = new Map<string, string>();
  const freshId = (oldId: string): string => {
    const existing = idMap.get(oldId);
    if (existing) return existing;
    const fresh = createId();
    idMap.set(oldId, fresh);
    return fresh;
  };

  parsed = {
    ...parsed,
    id: freshId(parsed.id),
    tempoMap: parsed.tempoMap.map((t) => ({ ...t, id: freshId(t.id) })),
    tracks: parsed.tracks.map((track) => {
      const newTrackId = freshId(track.id);
      return {
        ...track,
        id: newTrackId,
        measures: track.measures.map((measure) => ({
          ...measure,
          id: freshId(measure.id),
          voices: measure.voices.map((voice) => {
            const newVoiceId = freshId(voice.id);
            return {
              ...voice,
              id: newVoiceId,
              events: voice.events.map((event) => ({
                ...event,
                id: freshId(event.id),
                trackId: newTrackId,
                voiceId: newVoiceId,
              })),
            };
          }),
        })),
      };
    }),
  };
  warnings.push('Regenerated all object ids and re-linked track/voice references.');

  // ---- Reject non-positive durations up front (never repairable) ----
  const negativeDurationIssues: string[] = [];
  for (const track of parsed.tracks) {
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (event.durationTicks <= 0) {
            negativeDurationIssues.push(`Event ${event.id} has a non-positive durationTicks (${event.durationTicks}).`);
          }
        }
      }
    }
  }
  if (negativeDurationIssues.length > 0) {
    throw new GenerationValidationError(negativeDurationIssues);
  }

  // ---- Normalize tick positions to the measure grid ----
  parsed = {
    ...parsed,
    tracks: parsed.tracks.map((track) => ({
      ...track,
      measures: track.measures.map((measure, index) => ({
        ...measure,
        index,
        durationTicks: measureDurationTicks(measure.timeSignature, parsed.ppq),
      })),
    })),
  };
  parsed = rebuildMeasureTicks(parsed);
  warnings.push('Normalized measure indices and tick positions to the measure grid.');

  // ---- Repair underfull voices; collect unrepairable issues (overfull, out-of-range, monophonic overlap) ----
  const overfullIssues: string[] = [];
  const outOfRangeIssues: string[] = [];
  const overlapIssues: string[] = [];

  parsed = {
    ...parsed,
    tracks: parsed.tracks.map((track, trackIndex) => {
      const trackContext = context.tracks?.[trackIndex];

      return {
        ...track,
        measures: track.measures.map((measure) => ({
          ...measure,
          voices: measure.voices.map((voice) => {
            const sorted = [...voice.events].sort((a, b) => a.startTick - b.startTick);
            const covered = coveredTicks(sorted);

            if (covered > measure.durationTicks) {
              overfullIssues.push(
                `Measure ${measure.index} voice "${voice.name}" on track "${track.name}" is overfull (covers ${covered} ticks, measure is ${measure.durationTicks}).`,
              );
            }

            if (trackContext?.range) {
              for (const event of sorted) {
                if (isNoteEvent(event)) {
                  const midi = pitchToMidi(event.pitch);
                  if (midi < trackContext.range.lowestMidi || midi > trackContext.range.highestMidi) {
                    outOfRangeIssues.push(
                      `Note ${event.id} (midi ${midi}) is outside track "${track.name}"'s allowed range [${trackContext.range.lowestMidi}, ${trackContext.range.highestMidi}].`,
                    );
                  }
                }
              }
            }

            if (trackContext?.maximumPolyphony === 1) {
              for (let i = 0; i < sorted.length; i += 1) {
                for (let j = i + 1; j < sorted.length; j += 1) {
                  if (eventsOverlap(sorted[i], sorted[j])) {
                    overlapIssues.push(
                      `Notes ${sorted[i].id} and ${sorted[j].id} overlap in monophonic voice "${voice.name}" on track "${track.name}".`,
                    );
                  }
                }
              }
            }

            let events = sorted;
            if (covered < measure.durationTicks) {
              const before = sorted.length;
              events = padUnderfullVoice(sorted, measure, voice.id, track.id);
              warnings.push(
                `Padded underfull voice "${voice.name}" in measure ${measure.index} of track "${track.name}" with ${events.length - before} rest(s).`,
              );
            }

            return { ...voice, events };
          }),
        })),
      };
    }),
  };

  const rejectIssues = [...overfullIssues, ...outOfRangeIssues, ...overlapIssues];
  if (rejectIssues.length > 0) {
    throw new GenerationValidationError(rejectIssues);
  }

  return { score: parsed, warnings };
}

/**
 * Validates a regeneration provider's raw result before any candidate is
 * ever previewed or stored (spec §12/§37.8: "every AI-generated response
 * must be validated" — Task 19 review finding I1: this was previously
 * skipped entirely for `regenerateRegion`'s response, unlike
 * `generateScore`'s, which always went through `sanitizeGeneratedScore`).
 *
 * 1. Zod-parses the shape via `regenerateRegionResultSchema` (throws
 *    `GenerationValidationError` if it doesn't even match).
 * 2. For every candidate's fragment: its `ppq` must match `score.ppq`
 *    (mismatched resolution would silently corrupt tick math once
 *    spliced in), and every measure's every voice must cover *exactly*
 *    its own `durationTicks` — reusing the same `coveredTicks` merge-and-
 *    sum this module already uses for `sanitizeGeneratedScore`'s overfull-
 *    measure check, applied here as a stricter equality (not just
 *    "not overfull"): a regeneration candidate that leaves gaps or
 *    overflows can't be safely spliced into an otherwise-valid score the
 *    way a repairable whole-score generation can.
 *
 * Unlike `sanitizeGeneratedScore`, nothing here is repaired — no id
 * regeneration, no gap-padding: a candidate is either already correct or
 * it's rejected outright, since (unlike a brand-new generated score) it's
 * about to be spliced into an already-valid, already-committed score
 * (`acceptCandidate`/`replaceFragment`), where silently padding/altering
 * its content would violate spec §37.9's "candidates are non-destructive"
 * expectation just as much as skipping validation entirely would.
 *
 * Throws `GenerationValidationError` (with every issue found, not just the
 * first) on any problem; returns the parsed, still-untouched result
 * otherwise.
 */
export function validateRegenerateRegionResult(score: Score, json: unknown): RegenerateRegionResult {
  const parseResult = regenerateRegionResultSchema.safeParse(json);
  if (!parseResult.success) {
    throw new GenerationValidationError(parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const result = parseResult.data as RegenerateRegionResult;

  const issues: string[] = [];
  for (const candidate of result.candidates) {
    if (candidate.fragment.ppq !== score.ppq) {
      issues.push(
        `Candidate "${candidate.id}" fragment has ppq ${candidate.fragment.ppq}, expected the score's own ppq (${score.ppq}).`,
      );
      continue;
    }
    for (const trackFragment of candidate.fragment.tracks) {
      for (const measure of trackFragment.measures) {
        for (const voice of measure.voices) {
          const covered = coveredTicks(voice.events);
          if (covered !== measure.durationTicks) {
            issues.push(
              `Candidate "${candidate.id}" measure ${measure.index} voice "${voice.name}" on track "${trackFragment.trackId}" covers ${covered} ticks, expected exactly ${measure.durationTicks}.`,
            );
          }
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new GenerationValidationError(issues);
  }

  return result;
}
