import { describe, expect, it } from 'vitest';
import { assembleTrackMeasures, buildMeasureSpans, DEFAULT_TIME_SIGNATURE } from './measures.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent } from '@sudobility/music_types';
import { validateScore } from '../../domain/validation/validator.js';
import { createEmptyScore } from '../../domain/score/factory.js';

const PPQ = 480;
const C_MAJOR = { fifths: 0, mode: 'major' as const };
const TRACK_ID = 'track-1';

function note(overrides: Partial<NoteEvent> & Pick<NoteEvent, 'startTick' | 'durationTicks'>): NoteEvent {
  return {
    id: `note-${overrides.startTick}-${Math.random()}`,
    pitch: { step: 'C', accidental: 0, octave: 4 },
    velocity: 80,
    voiceId: 'placeholder',
    trackId: TRACK_ID,
    ...overrides,
  };
}

describe('buildMeasureSpans', () => {
  it('produces one default-meter measure for an empty file', () => {
    const spans = buildMeasureSpans([], PPQ, 0);
    expect(spans).toEqual([{ index: 0, startTick: 0, durationTicks: 1920, timeSignature: DEFAULT_TIME_SIGNATURE }]);
  });

  it('produces enough measures to cover endTick when there are no time signature changes', () => {
    const spans = buildMeasureSpans([], PPQ, 5000);
    expect(spans).toHaveLength(3); // 3 * 1920 = 5760 >= 5000
    expect(spans[0].startTick).toBe(0);
    expect(spans[1].startTick).toBe(1920);
    expect(spans[2].startTick).toBe(3840);
    expect(spans.every((s) => s.timeSignature.numerator === 4 && s.timeSignature.denominator === 4)).toBe(true);
  });

  it('switches meter at a time signature change tick', () => {
    const changes = [
      { tick: 0, timeSignature: { numerator: 4, denominator: 4 } },
      { tick: 3840, timeSignature: { numerator: 3, denominator: 4 } }, // after 2 measures of 4/4
    ];
    const spans = buildMeasureSpans(changes, PPQ, 3840 + 1440 * 2);
    expect(spans[0].timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(spans[1].timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(spans[2].startTick).toBe(3840);
    expect(spans[2].timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(spans[2].durationTicks).toBe(1440);
  });

  it('synthesizes a default-meter origin segment when the first change is not at tick 0', () => {
    const spans = buildMeasureSpans([{ tick: 1920, timeSignature: { numerator: 3, denominator: 4 } }], PPQ, 1920 + 1440);
    expect(spans[0]).toEqual({ index: 0, startTick: 0, durationTicks: 1920, timeSignature: DEFAULT_TIME_SIGNATURE });
    expect(spans[1].timeSignature).toEqual({ numerator: 3, denominator: 4 });
  });
});

describe('assembleTrackMeasures', () => {
  it('fully rests every measure/voice when voiceLanes is empty', () => {
    const spans = buildMeasureSpans([], PPQ, 3840);
    const measures = assembleTrackMeasures([], spans, C_MAJOR, TRACK_ID);
    expect(measures).toHaveLength(2);
    for (const measure of measures) {
      expect(measure.voices).toHaveLength(1);
      expect(measure.voices[0].events).toHaveLength(1);
      const [rest] = measure.voices[0].events;
      expect(isNoteEvent(rest)).toBe(false);
      expect(rest.durationTicks).toBe(measure.durationTicks);
    }
  });

  it('places non-overlapping single-measure notes and fills surrounding gaps with rests', () => {
    const spans = buildMeasureSpans([], PPQ, 1920);
    const lane = [note({ startTick: 480, durationTicks: 480 })]; // a quarter note on beat 2
    const measures = assembleTrackMeasures([lane], spans, C_MAJOR, TRACK_ID);

    expect(measures).toHaveLength(1);
    const events = measures[0].voices[0].events;
    expect(events).toHaveLength(3); // rest, note, rest
    expect(events[0].startTick).toBe(0);
    expect(events[0].durationTicks).toBe(480);
    expect(isNoteEvent(events[1])).toBe(true);
    expect(events[2].startTick).toBe(960);
    expect(events[2].durationTicks).toBe(960);
  });

  it('splits a note crossing a measure boundary into a tied chain', () => {
    const spans = buildMeasureSpans([], PPQ, 3840);
    const lane = [note({ startTick: 1440, durationTicks: 960 })]; // spans measure 0->1 boundary at 1920
    const measures = assembleTrackMeasures([lane], spans, C_MAJOR, TRACK_ID);

    const firstMeasureNotes = measures[0].voices[0].events.filter(isNoteEvent);
    const secondMeasureNotes = measures[1].voices[0].events.filter(isNoteEvent);
    expect(firstMeasureNotes).toHaveLength(1);
    expect(secondMeasureNotes).toHaveLength(1);

    const [firstSeg] = firstMeasureNotes;
    const [secondSeg] = secondMeasureNotes;
    expect(firstSeg.startTick).toBe(1440);
    expect(firstSeg.durationTicks).toBe(480);
    expect(firstSeg.tieStart).toBe(true);
    expect(secondSeg.startTick).toBe(1920);
    expect(secondSeg.durationTicks).toBe(480);
    expect(secondSeg.tieStop).toBe(true);
  });

  it('produces multiple voices for polyphonic lanes, all satisfying validateScore', () => {
    const spans = buildMeasureSpans([], PPQ, 1920);
    const laneA = [note({ startTick: 0, durationTicks: 1920, pitch: { step: 'C', accidental: 0, octave: 5 } })];
    const laneB = [note({ startTick: 0, durationTicks: 1920, pitch: { step: 'C', accidental: 0, octave: 3 } })];
    const measures = assembleTrackMeasures([laneA, laneB], spans, C_MAJOR, TRACK_ID);
    expect(measures[0].voices).toHaveLength(2);

    const score = createEmptyScore({ title: 'T', measures: 0, tracks: [{ name: 'Piano', id: TRACK_ID }] });
    score.tracks[0].measures = measures;
    const errors = validateScore(score).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });
});
