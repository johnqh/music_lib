/**
 * Contour-based melody generation (spec §31): a random walk over scale
 * degrees, grouped into phrases with AABA-style repetition and a
 * cadential (tonic-resolving) final measure.
 */
import type { KeySignature, TimeSignature } from '@sudobility/music_types';
import { measureDurationTicks, ticksFor } from '../../../domain/time/ticks';
import type { ScaleType } from '../music-theory';
import { scaleDegreeToPitch } from '../music-theory';
import type { SeededRng } from '../prng';
import type { Step } from './shared';
import { fillDurationsForMeasure } from './shared';

export type MelodyComplexity = 'simple' | 'moderate' | 'complex';

export type MelodyOptions = {
  key: KeySignature;
  timeSignature: TimeSignature;
  ppq: number;
  measureCount: number;
  octave: number;
  complexity: MelodyComplexity;
  /** Overrides the scale (default: major scale for major keys, natural minor for minor keys). */
  scaleType?: ScaleType;
  rng: SeededRng;
};

/** Candidate note-duration lengths (in ticks), weighted by repetition, for each complexity level. */
function durationPool(ppq: number, complexity: MelodyComplexity): number[] {
  const whole = ticksFor('whole', ppq);
  const half = ticksFor('half', ppq);
  const quarter = ticksFor('quarter', ppq);
  const eighth = ticksFor('eighth', ppq);
  const sixteenth = ticksFor('sixteenth', ppq);
  const dottedQuarter = ticksFor('dotted-quarter', ppq);

  if (complexity === 'simple') return [quarter, quarter, quarter, half, half, whole];
  if (complexity === 'moderate') {
    return [eighth, eighth, eighth, quarter, quarter, quarter, half, dottedQuarter];
  }
  return [sixteenth, sixteenth, eighth, eighth, eighth, quarter, quarter, dottedQuarter];
}

/** Weighted scale-degree motions: mostly stepwise, occasional leaps, rare larger jumps. */
const MOTION_CHOICES = [-3, -2, -1, -1, -1, 0, 1, 1, 1, 2, 3];

function nextDegree(rng: SeededRng, degree: number): number {
  return degree + rng.pick(MOTION_CHOICES);
}

const REST_PROBABILITY = 0.08;

/** Generates one `phraseLen`-measure phrase, contour-walking a scale-degree index starting at `startDegree`. */
function generatePhrase(
  rng: SeededRng,
  opts: MelodyOptions,
  phraseLen: number,
  startDegree: number,
  scaleType: ScaleType,
): { measures: Step[][]; endDegree: number } {
  const pool = durationPool(opts.ppq, opts.complexity);
  const measureTicks = measureDurationTicks(opts.timeSignature, opts.ppq);
  const measures: Step[][] = [];
  let degree = startDegree;

  for (let m = 0; m < phraseLen; m += 1) {
    const durations = fillDurationsForMeasure(rng, measureTicks, pool);
    const steps: Step[] = durations.map((durationTicks) => {
      if (rng.next() < REST_PROBABILITY) {
        return { pitches: [], durationTicks };
      }
      degree = nextDegree(rng, degree);
      const pitch = scaleDegreeToPitch(opts.key, scaleType, opts.octave, degree);
      return { pitches: [pitch], durationTicks, velocity: 78 + rng.int(0, 20) };
    });
    measures.push(steps);
  }

  return { measures, endDegree: degree };
}

/** Rewrites a measure's final step to resolve to the tonic, preserving the measure's total duration and step count. */
function applyCadentialEnding(measure: Step[], key: KeySignature, octave: number, scaleType: ScaleType): Step[] {
  if (measure.length === 0) return measure;
  const last = measure[measure.length - 1];
  const tonic = scaleDegreeToPitch(key, scaleType, octave, 0);
  return [...measure.slice(0, -1), { pitches: [tonic], durationTicks: last.durationTicks, velocity: last.velocity ?? 90 }];
}

/**
 * Generates a contour-based melody across `opts.measureCount` measures:
 * up to two 4-measure phrases (A, B) combined AABA-style (cycling if
 * `measureCount` isn't a multiple of 4, trimmed to fit), with the final
 * measure rewritten to a cadential (tonic) ending. Deterministic for a
 * given `opts.rng` state.
 */
export function generateMelody(opts: MelodyOptions): Step[][] {
  const scaleType = opts.scaleType ?? (opts.key.mode === 'major' ? 'major' : 'naturalMinor');
  const phraseLen = Math.min(4, Math.max(1, opts.measureCount));

  const phraseA = generatePhrase(opts.rng, opts, phraseLen, 0, scaleType);
  const phraseB =
    opts.measureCount > phraseLen
      ? generatePhrase(opts.rng, opts, phraseLen, phraseA.endDegree + 2, scaleType)
      : phraseA;

  const order: Array<'A' | 'B'> = ['A', 'A', 'B', 'A'];
  const measures: Step[][] = [];
  let blockIndex = 0;
  while (measures.length < opts.measureCount) {
    const phrase = order[blockIndex % order.length] === 'A' ? phraseA.measures : phraseB.measures;
    for (const measure of phrase) {
      if (measures.length >= opts.measureCount) break;
      measures.push(measure);
    }
    blockIndex += 1;
  }

  measures[measures.length - 1] = applyCadentialEnding(measures[measures.length - 1], opts.key, opts.octave, scaleType);
  return measures;
}
