import { describe, expect, it } from 'vitest';
import type { TimeSignature } from '@sudobility/music_types';
import { measureDurationTicks } from '../../../domain/time/ticks';
import { generateDrums } from './drums';

const PPQ = 480;
const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };

describe('generateDrums', () => {
  it('returns measureCount measures, each summing to exactly the measure duration', () => {
    const measures = generateDrums({ timeSignature: FOUR_FOUR, ppq: PPQ, measureCount: 4, groove: 'rock' });
    const measureTicks = measureDurationTicks(FOUR_FOUR, PPQ);
    expect(measures).toHaveLength(4);
    for (const steps of measures) {
      expect(steps.reduce((sum, s) => sum + s.durationTicks, 0)).toBe(measureTicks);
    }
  });

  it('rock groove: every step has at least a hi-hat hit (no full-step rests)', () => {
    const [measure] = generateDrums({ timeSignature: FOUR_FOUR, ppq: PPQ, measureCount: 1, groove: 'rock' });
    expect(measure.every((s) => s.pitches.length > 0)).toBe(true);
  });

  it('places kick and snare hits on some steps (non-empty groove)', () => {
    const [measure] = generateDrums({ timeSignature: FOUR_FOUR, ppq: PPQ, measureCount: 1, groove: 'rock' });
    const allPitchCounts = measure.map((s) => s.pitches.length);
    expect(Math.max(...allPitchCounts)).toBeGreaterThan(1);
  });

  it('is deterministic (no randomness) and identical across measures for a stable groove', () => {
    const measures = generateDrums({ timeSignature: FOUR_FOUR, ppq: PPQ, measureCount: 3, groove: 'basic' });
    expect(measures[0]).toEqual(measures[1]);
    expect(measures[1]).toEqual(measures[2]);
  });

  it('handles a time signature not evenly divisible by an eighth note gracefully (exact fill)', () => {
    const oddMeter: TimeSignature = { numerator: 5, denominator: 8 };
    const measures = generateDrums({ timeSignature: oddMeter, ppq: PPQ, measureCount: 1, groove: 'basic' });
    const measureTicks = measureDurationTicks(oddMeter, PPQ);
    expect(measures[0].reduce((sum, s) => sum + s.durationTicks, 0)).toBe(measureTicks);
  });
});
