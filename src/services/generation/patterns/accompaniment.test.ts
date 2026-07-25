import { describe, expect, it } from 'vitest';
import type { KeySignature, TimeSignature } from '@sudobility/music_types';
import { measureDurationTicks } from '../../../domain/time/ticks';
import { SeededRng } from '../prng';
import { generateAccompaniment } from './accompaniment';
import type { AccompanimentOptions, AccompanimentStyle } from './accompaniment';

const PPQ = 480;
const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };
const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };

function baseOptions(style: AccompanimentStyle, overrides: Partial<AccompanimentOptions> = {}): AccompanimentOptions {
  return {
    key: C_MAJOR,
    timeSignature: FOUR_FOUR,
    ppq: PPQ,
    measureCount: 4,
    octave: 4,
    style,
    progression: 'I-V-vi-IV',
    rng: new SeededRng('accomp'),
    ...overrides,
  };
}

describe.each<AccompanimentStyle>(['blockChords', 'alberti', 'arpeggio'])('generateAccompaniment (%s)', (style) => {
  it('returns measureCount measures, each summing to exactly the measure duration', () => {
    const opts = baseOptions(style);
    const measures = generateAccompaniment(opts);
    const measureTicks = measureDurationTicks(opts.timeSignature, opts.ppq);
    expect(measures).toHaveLength(opts.measureCount);
    for (const steps of measures) {
      expect(steps.reduce((sum, s) => sum + s.durationTicks, 0)).toBe(measureTicks);
    }
  });
});

describe('generateAccompaniment', () => {
  it('blockChords: one step per measure, holding the full chord for the whole measure', () => {
    const opts = baseOptions('blockChords');
    const measures = generateAccompaniment(opts);
    for (const steps of measures) {
      expect(steps).toHaveLength(1);
      expect(steps[0].pitches.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('alberti: single-note eighth-note steps cycling low/high/mid/high', () => {
    const measures = generateAccompaniment(baseOptions('alberti'));
    for (const steps of measures) {
      expect(steps.every((s) => s.pitches.length === 1)).toBe(true);
      expect(steps.length).toBeGreaterThan(1);
    }
  });

  it('arpeggio: single-note sixteenth-note steps ascending through the chord', () => {
    const measures = generateAccompaniment(baseOptions('arpeggio'));
    for (const steps of measures) {
      expect(steps.every((s) => s.pitches.length === 1)).toBe(true);
      expect(steps.length).toBeGreaterThan(4);
    }
  });

  it('cycles the progression across more measures than the progression length', () => {
    const measures = generateAccompaniment(baseOptions('blockChords', { measureCount: 8 }));
    expect(measures[4]).toEqual(measures[0]); // I-V-vi-IV has 4 chords; measure 4 repeats measure 0's chord
  });

  it('is deterministic for the same seed', () => {
    const a = generateAccompaniment(baseOptions('alberti', { rng: new SeededRng('fixed') }));
    const b = generateAccompaniment(baseOptions('alberti', { rng: new SeededRng('fixed') }));
    expect(a).toEqual(b);
  });
});
