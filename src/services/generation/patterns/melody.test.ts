import { describe, expect, it } from 'vitest';
import { pitchToMidi } from '../../../domain/pitch/pitch.js';
import type { KeySignature, TimeSignature } from '@sudobility/music_types';
import { measureDurationTicks } from '../../../domain/time/ticks.js';
import { keyTonicPitchClass } from '../music-theory.js';
import { SeededRng } from '../prng.js';
import { generateMelody } from './melody.js';
import type { MelodyOptions } from './melody.js';

const PPQ = 480;
const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };
const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };

function baseOptions(overrides: Partial<MelodyOptions> = {}): MelodyOptions {
  return {
    key: C_MAJOR,
    timeSignature: FOUR_FOUR,
    ppq: PPQ,
    measureCount: 8,
    octave: 4,
    complexity: 'moderate',
    rng: new SeededRng('melody-seed'),
    ...overrides,
  };
}

describe('generateMelody', () => {
  it('returns exactly measureCount measures, each summing to exactly the measure duration', () => {
    const opts = baseOptions();
    const measures = generateMelody(opts);
    expect(measures).toHaveLength(opts.measureCount);
    const measureTicks = measureDurationTicks(opts.timeSignature, opts.ppq);
    for (const steps of measures) {
      const total = steps.reduce((sum, s) => sum + s.durationTicks, 0);
      expect(total).toBe(measureTicks);
    }
  });

  it('is deterministic for the same rng seed and options', () => {
    const a = generateMelody(baseOptions({ rng: new SeededRng('same-seed') }));
    const b = generateMelody(baseOptions({ rng: new SeededRng('same-seed') }));
    expect(a).toEqual(b);
  });

  it('differs for different rng seeds', () => {
    const a = generateMelody(baseOptions({ rng: new SeededRng('seed-a') }));
    const b = generateMelody(baseOptions({ rng: new SeededRng('seed-b') }));
    expect(a).not.toEqual(b);
  });

  it('ends on a cadential (tonic) note', () => {
    const opts = baseOptions();
    const measures = generateMelody(opts);
    const lastMeasure = measures[measures.length - 1];
    const lastStep = lastMeasure[lastMeasure.length - 1];
    expect(lastStep.pitches).toHaveLength(1);
    const tonicPitchClass = keyTonicPitchClass(opts.key);
    expect(pitchToMidi(lastStep.pitches[0]) % 12).toBe(tonicPitchClass);
  });

  it('repeats phrase content AABA-style across an 8-measure melody (measures 4-6 mirror 0-2, phrase A repeated)', () => {
    const opts = baseOptions({ measureCount: 8 });
    const measures = generateMelody(opts);
    // 8 measures = two full 4-measure "A" blocks (order ['A','A','B','A'] only reaches its
    // second entry, also 'A', before measureCount is satisfied): [A0,A1,A2,A3,A0,A1,A2,A3].
    // The very last measure (index 7) has a cadential ending applied, so it won't match A3 exactly.
    expect(measures[4]).toEqual(measures[0]);
    expect(measures[5]).toEqual(measures[1]);
    expect(measures[6]).toEqual(measures[2]);
  });

  it('handles a single-measure melody without error, still cadential and duration-correct', () => {
    const opts = baseOptions({ measureCount: 1 });
    const measures = generateMelody(opts);
    expect(measures).toHaveLength(1);
    const measureTicks = measureDurationTicks(opts.timeSignature, opts.ppq);
    expect(measures[0].reduce((sum, s) => sum + s.durationTicks, 0)).toBe(measureTicks);
  });

  it('works for a minor key and a non-4/4 time signature', () => {
    const opts = baseOptions({
      key: { fifths: -1, mode: 'minor' },
      timeSignature: { numerator: 3, denominator: 4 },
      measureCount: 3,
    });
    const measures = generateMelody(opts);
    const measureTicks = measureDurationTicks(opts.timeSignature, opts.ppq);
    expect(measures).toHaveLength(3);
    for (const steps of measures) {
      expect(steps.reduce((sum, s) => sum + s.durationTicks, 0)).toBe(measureTicks);
    }
  });

  it('produces different note content for different complexity levels (same seed)', () => {
    const simple = generateMelody(baseOptions({ complexity: 'simple', rng: new SeededRng('complexity') }));
    const complex = generateMelody(baseOptions({ complexity: 'complex', rng: new SeededRng('complexity') }));
    expect(simple).not.toEqual(complex);
  });
});
