/**
 * Shared building blocks for the pattern generators in this directory
 * (melody.ts, accompaniment.ts, bass.ts, drums.ts): a common per-measure
 * "step" representation, a duration-filling helper that always sums to
 * exactly a measure's length (satisfying spec §31's "generation must
 * always satisfy measure lengths"), and a `Step[][]` -> `Measure[]`
 * builder that produces data-model-valid measures (one voice per measure,
 * ids via the caller's `SeededRng` so generation stays deterministic; see
 * `prng.ts`'s doc comment on why `createId()` is never used here).
 */
import type { KeySignature, Measure, MusicalEvent, Pitch, TimeSignature } from '@sudobility/music_types';
import { measureDurationTicks } from '../../../domain/time/ticks.js';
import type { SeededRng } from '../prng.js';

/** One rhythmic slot within a pattern measure: zero pitches = a rest, one = a single note, 2+ = a simultaneous chord (shared start/duration). */
export type Step = { pitches: Pitch[]; durationTicks: number; velocity?: number };

const DEFAULT_VELOCITY = 80;

/**
 * Greedily fills `measureTicks` from `pool` (candidate duration lengths in
 * ticks; repeat entries to bias how often a length is chosen), picking a
 * random pool entry that fits the remainder at each step. When no pool
 * entry fits what's left, the remainder is consumed exactly as one final
 * step — so the returned durations always sum to exactly `measureTicks`,
 * regardless of `ppq`/time signature/pool content.
 */
export function fillDurationsForMeasure(rng: SeededRng, measureTicks: number, pool: number[]): number[] {
  const durations: number[] = [];
  let remaining = measureTicks;
  while (remaining > 0) {
    const candidates = pool.filter((d) => d > 0 && d <= remaining);
    if (candidates.length === 0) {
      durations.push(remaining);
      remaining = 0;
      break;
    }
    const chosen = rng.pick(candidates);
    durations.push(chosen);
    remaining -= chosen;
  }
  return durations;
}

/**
 * Builds one `Measure` (single voice) from `steps` positioned at
 * `template`'s index/startTick/durationTicks/timeSignature/keySignature —
 * used both by `buildMeasuresFromSteps` (fresh generation) and by the
 * regeneration controller's per-measure transforms (which must preserve an
 * existing measure's position/signatures, only replacing its content).
 * `steps`' durations must already sum to exactly `template.durationTicks`.
 */
export function buildMeasureFromSteps(
  steps: Step[],
  template: Pick<Measure, 'index' | 'startTick' | 'durationTicks' | 'timeSignature' | 'keySignature'>,
  trackId: string,
  rng: SeededRng,
): Measure {
  const voiceId = rng.id('voice');
  let cursor = template.startTick;
  const events: MusicalEvent[] = [];

  for (const step of steps) {
    if (step.pitches.length === 0) {
      events.push({ id: rng.id('rest'), startTick: cursor, durationTicks: step.durationTicks, voiceId, trackId });
    } else {
      for (const pitch of step.pitches) {
        events.push({
          id: rng.id('note'),
          pitch,
          startTick: cursor,
          durationTicks: step.durationTicks,
          velocity: step.velocity ?? DEFAULT_VELOCITY,
          voiceId,
          trackId,
        });
      }
    }
    cursor += step.durationTicks;
  }

  return {
    id: rng.id('measure'),
    index: template.index,
    startTick: template.startTick,
    durationTicks: template.durationTicks,
    timeSignature: template.timeSignature,
    keySignature: template.keySignature,
    voices: [{ id: voiceId, name: 'Voice 1', events }],
  };
}

/**
 * Builds `measuresOfSteps.length` consecutive single-voice measures
 * starting at tick 0, one call to `buildMeasureFromSteps` per measure.
 */
export function buildMeasuresFromSteps(
  measuresOfSteps: Step[][],
  ppq: number,
  timeSignature: TimeSignature,
  keySignature: KeySignature,
  trackId: string,
  rng: SeededRng,
): Measure[] {
  const measureTicks = measureDurationTicks(timeSignature, ppq);
  return measuresOfSteps.map((steps, index) =>
    buildMeasureFromSteps(
      steps,
      { index, startTick: index * measureTicks, durationTicks: measureTicks, timeSignature, keySignature },
      trackId,
      rng,
    ),
  );
}
