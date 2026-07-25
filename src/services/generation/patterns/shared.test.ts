import { describe, expect, it } from 'vitest';
import { isNoteEvent, isRestEvent } from '@sudobility/music_types';
import type { KeySignature, TimeSignature } from '@sudobility/music_types';
import { ticksFor } from '../../../domain/time/ticks';
import { SeededRng } from '../prng';
import { buildMeasuresFromSteps, fillDurationsForMeasure } from './shared';
import type { Step } from './shared';

const PPQ = 480;
const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };
const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };

describe('fillDurationsForMeasure', () => {
  it('always sums to exactly measureTicks, for a pool that divides evenly', () => {
    const rng = new SeededRng('fill-1');
    const measureTicks = 1920; // 4/4 at ppq 480
    const pool = [ticksFor('quarter', PPQ), ticksFor('eighth', PPQ), ticksFor('half', PPQ)];
    for (let i = 0; i < 20; i += 1) {
      const durations = fillDurationsForMeasure(rng, measureTicks, pool);
      expect(durations.reduce((a, b) => a + b, 0)).toBe(measureTicks);
    }
  });

  it('falls back to consuming the exact remainder when no pool entry fits', () => {
    const rng = new SeededRng('fill-2');
    const durations = fillDurationsForMeasure(rng, 100, [64]);
    // 64 fits once (remaining 36), then no pool entry (64) fits 36, so it's consumed whole.
    expect(durations).toEqual([64, 36]);
  });

  it('is deterministic for the same seed', () => {
    const a = fillDurationsForMeasure(new SeededRng('fill-seed'), 1920, [480, 240, 960]);
    const b = fillDurationsForMeasure(new SeededRng('fill-seed'), 1920, [480, 240, 960]);
    expect(a).toEqual(b);
  });
});

describe('buildMeasuresFromSteps', () => {
  it('builds one voice per measure whose events sum to exactly the measure duration', () => {
    const rng = new SeededRng('build-1');
    const measureTicks = 1920;
    const steps: Step[][] = [
      [
        { pitches: [{ step: 'C', accidental: 0, octave: 4 }], durationTicks: measureTicks / 2 },
        { pitches: [], durationTicks: measureTicks / 2 },
      ],
      [{ pitches: [{ step: 'D', accidental: 0, octave: 4 }], durationTicks: measureTicks }],
    ];

    const measures = buildMeasuresFromSteps(steps, PPQ, FOUR_FOUR, C_MAJOR, 'track-1', rng);

    expect(measures).toHaveLength(2);
    expect(measures[0].index).toBe(0);
    expect(measures[0].startTick).toBe(0);
    expect(measures[1].startTick).toBe(measureTicks);

    for (const measure of measures) {
      const covered = measure.voices[0].events.reduce((sum, e) => sum + e.durationTicks, 0);
      expect(covered).toBe(measure.durationTicks);
      for (const event of measure.voices[0].events) {
        expect(event.trackId).toBe('track-1');
        expect(event.voiceId).toBe(measure.voices[0].id);
      }
    }

    const [note, rest] = measures[0].voices[0].events;
    expect(isNoteEvent(note)).toBe(true);
    expect(isRestEvent(rest)).toBe(true);
  });

  it('builds simultaneous NoteEvents for a step with multiple pitches (a chord)', () => {
    const rng = new SeededRng('build-2');
    const measureTicks = 1920;
    const chordStep: Step = {
      pitches: [
        { step: 'C', accidental: 0, octave: 4 },
        { step: 'E', accidental: 0, octave: 4 },
        { step: 'G', accidental: 0, octave: 4 },
      ],
      durationTicks: measureTicks,
    };

    const [measure] = buildMeasuresFromSteps([[chordStep]], PPQ, FOUR_FOUR, C_MAJOR, 'track-1', rng);
    const events = measure.voices[0].events;
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.startTick === 0 && e.durationTicks === measureTicks)).toBe(true);
    expect(new Set(events.map((e) => e.id)).size).toBe(3);
  });

  it('produces unique ids across every measure/voice/event', () => {
    const rng = new SeededRng('build-3');
    const measureTicks = 1920;
    const steps: Step[][] = Array.from({ length: 4 }, () => [
      { pitches: [{ step: 'C', accidental: 0, octave: 4 }], durationTicks: measureTicks },
    ]);
    const measures = buildMeasuresFromSteps(steps, PPQ, FOUR_FOUR, C_MAJOR, 'track-1', rng);
    const allIds = [
      ...measures.map((m) => m.id),
      ...measures.map((m) => m.voices[0].id),
      ...measures.flatMap((m) => m.voices[0].events.map((e) => e.id)),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('is deterministic for the same seed', () => {
    const steps: Step[][] = [[{ pitches: [{ step: 'C', accidental: 0, octave: 4 }], durationTicks: 1920 }]];
    const a = buildMeasuresFromSteps(steps, PPQ, FOUR_FOUR, C_MAJOR, 'track-1', new SeededRng('det'));
    const b = buildMeasuresFromSteps(steps, PPQ, FOUR_FOUR, C_MAJOR, 'track-1', new SeededRng('det'));
    expect(a).toEqual(b);
  });
});
