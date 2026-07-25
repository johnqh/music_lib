import { describe, expect, it } from 'vitest';
import type { KeySignature, TimeSignature } from '@sudobility/music_types';
import { measureDurationTicks } from '../../../domain/time/ticks';
import { SeededRng } from '../prng';
import { generateBass } from './bass';
import type { BassOptions, BassStyle } from './bass';

const PPQ = 480;
const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };
const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };

function baseOptions(style: BassStyle, overrides: Partial<BassOptions> = {}): BassOptions {
  return {
    key: C_MAJOR,
    timeSignature: FOUR_FOUR,
    ppq: PPQ,
    measureCount: 4,
    octave: 2,
    style,
    progression: 'I-V-vi-IV',
    rng: new SeededRng('bass'),
    ...overrides,
  };
}

describe.each<BassStyle>(['roots', 'walking'])('generateBass (%s)', (style) => {
  it('returns measureCount measures, each summing to exactly the measure duration', () => {
    const opts = baseOptions(style);
    const measures = generateBass(opts);
    const measureTicks = measureDurationTicks(opts.timeSignature, opts.ppq);
    expect(measures).toHaveLength(opts.measureCount);
    for (const steps of measures) {
      expect(steps.reduce((sum, s) => sum + s.durationTicks, 0)).toBe(measureTicks);
    }
  });
});

describe('generateBass', () => {
  it('roots: one whole-measure note per measure', () => {
    const measures = generateBass(baseOptions('roots'));
    for (const steps of measures) {
      expect(steps).toHaveLength(1);
      expect(steps[0].pitches).toHaveLength(1);
    }
  });

  it('walking: multiple single-note quarter-ish steps per measure', () => {
    const measures = generateBass(baseOptions('walking'));
    for (const steps of measures) {
      expect(steps.length).toBeGreaterThan(1);
      expect(steps.every((s) => s.pitches.length === 1)).toBe(true);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = generateBass(baseOptions('walking', { rng: new SeededRng('fixed') }));
    const b = generateBass(baseOptions('walking', { rng: new SeededRng('fixed') }));
    expect(a).toEqual(b);
  });

  it('differs between roots and walking styles', () => {
    const roots = generateBass(baseOptions('roots', { rng: new SeededRng('style-cmp') }));
    const walking = generateBass(baseOptions('walking', { rng: new SeededRng('style-cmp') }));
    expect(roots).not.toEqual(walking);
  });
});
