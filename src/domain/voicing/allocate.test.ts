import { describe, expect, it } from 'vitest';
import { allocateVoices } from './allocate.js';
import type { NoteEvent, Pitch } from '@sudobility/music_types';

const TRACK = 't1';

function midiPitch(midi: number): Pitch {
  // C4 = 60; build a plain (unspelled-fancy) pitch a fixed number of
  // semitones from C4 for test purposes — spelling correctness isn't
  // under test here, only the resulting MIDI value.
  const octave = 4 + Math.floor((midi - 60) / 12);
  const semitoneInOctave = (((midi - 60) % 12) + 12) % 12;
  const steps: Array<{ step: Pitch['step']; accidental: Pitch['accidental'] }> = [
    { step: 'C', accidental: 0 },
    { step: 'C', accidental: 1 },
    { step: 'D', accidental: 0 },
    { step: 'D', accidental: 1 },
    { step: 'E', accidental: 0 },
    { step: 'F', accidental: 0 },
    { step: 'F', accidental: 1 },
    { step: 'G', accidental: 0 },
    { step: 'G', accidental: 1 },
    { step: 'A', accidental: 0 },
    { step: 'A', accidental: 1 },
    { step: 'B', accidental: 0 },
  ];
  const { step, accidental } = steps[semitoneInOctave];
  return { step, accidental, octave };
}

function note(
  id: string,
  startTick: number,
  durationTicks: number,
  midi = 60,
  overrides: Partial<NoteEvent> = {},
): NoteEvent {
  return {
    id,
    pitch: midiPitch(midi),
    startTick,
    durationTicks,
    velocity: 80,
    voiceId: 'source-voice',
    trackId: TRACK,
    ...overrides,
  };
}

describe('allocateVoices', () => {
  it('returns an empty array for no notes', () => {
    expect(allocateVoices([], { maxVoices: 4 })).toEqual([]);
  });

  it('is a pure function: never mutates its input', () => {
    const input = [note('a', 0, 480, 60)];
    const snapshot = JSON.parse(JSON.stringify(input));
    allocateVoices(input, { maxVoices: 4 });
    expect(input).toEqual(snapshot);
  });

  it('assigns a single note to voice 0', () => {
    const result = allocateVoices([note('a', 0, 480, 60)], { maxVoices: 4 });
    expect(result).toHaveLength(1);
    expect(result[0].voiceIndex).toBe(0);
    expect(result[0].notes.map((n) => n.id)).toEqual(['a']);
  });

  describe('staff assignment (default splitPoint 60)', () => {
    it('sends a note at or above the split point to the upper staff', () => {
      const result = allocateVoices([note('a', 0, 480, 60)], { maxVoices: 4 });
      expect(result[0].staff).toBe('upper');
    });

    it('sends a note below the split point to the lower staff', () => {
      const result = allocateVoices([note('a', 0, 480, 59)], { maxVoices: 4 });
      expect(result[0].staff).toBe('lower');
    });
  });

  describe('custom splitPoint', () => {
    it('uses the given splitPoint instead of the default 60', () => {
      const result = allocateVoices([note('a', 0, 480, 60)], { maxVoices: 4, splitPoint: 72 });
      expect(result[0].staff).toBe('lower');
    });
  });

  it('groups simultaneous, equal-duration notes as a chord in one voice', () => {
    const notes = [note('a', 0, 480, 60), note('b', 0, 480, 64), note('c', 0, 480, 67)];
    const result = allocateVoices(notes, { maxVoices: 4 });
    expect(result).toHaveLength(1);
    expect(result[0].voiceIndex).toBe(0);
    expect(result[0].notes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('splits a chord straddling the split point into two staff groups sharing one voiceIndex', () => {
    const notes = [note('low', 0, 480, 55), note('high', 0, 480, 65)];
    const result = allocateVoices(notes, { maxVoices: 4 });
    expect(result).toHaveLength(2);
    const upper = result.find((g) => g.staff === 'upper')!;
    const lower = result.find((g) => g.staff === 'lower')!;
    expect(upper.notes.map((n) => n.id)).toEqual(['high']);
    expect(lower.notes.map((n) => n.id)).toEqual(['low']);
    expect(upper.voiceIndex).toBe(lower.voiceIndex);
  });

  it('does not treat simultaneous notes of different durations as one chord (they need separate voices)', () => {
    const notes = [note('a', 0, 480, 60), note('b', 0, 240, 64)];
    const result = allocateVoices(notes, { maxVoices: 4 });
    const groupOf = (id: string) => result.find((g) => g.notes.some((n) => n.id === id))!;
    expect(groupOf('a').voiceIndex).not.toBe(groupOf('b').voiceIndex);
  });

  it('assigns overlapping independent lines to separate voices', () => {
    const notes = [note('long', 0, 960, 60), note('short', 480, 480, 72)];
    const result = allocateVoices(notes, { maxVoices: 4 });
    const groupOf = (id: string) => result.find((g) => g.notes.some((n) => n.id === id))!;
    expect(groupOf('long').voiceIndex).not.toBe(groupOf('short').voiceIndex);
  });

  it('prefers minimal voice-hopping: reuses the available voice whose last note ended closest before the new note', () => {
    // voice 0: note X [0, 400)
    // voice 1 (forced open because it overlaps X): note Y [100, 200)
    // note Z at [500, 600): both voices are available (400<=500, 200<=500);
    // voice 0's lastEnd (400) is closer to 500 than voice 1's (200), so Z
    // should land in voice 0 alongside X.
    const notes = [note('x', 0, 400, 60), note('y', 100, 100, 72), note('z', 500, 100, 60)];
    const result = allocateVoices(notes, { maxVoices: 4 });
    const groupOf = (id: string) => result.find((g) => g.notes.some((n) => n.id === id))!;
    expect(groupOf('z').voiceIndex).toBe(groupOf('x').voiceIndex);
  });

  it('respects maxVoices, never allocating more voice indices than allowed', () => {
    const notes = [
      note('a', 0, 500, 60),
      note('b', 10, 500, 62),
      note('c', 20, 500, 64),
      note('d', 30, 500, 65),
    ];
    const result = allocateVoices(notes, { maxVoices: 2 });
    const voiceIndices = new Set(result.map((g) => g.voiceIndex));
    expect(voiceIndices.size).toBeLessThanOrEqual(2);
    // Every note should still appear exactly once across the output.
    const allIds = result.flatMap((g) => g.notes.map((n) => n.id)).sort();
    expect(allIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('respects maxVoices of 1, forcing everything into voice 0', () => {
    const notes = [note('a', 0, 480, 60), note('b', 100, 480, 72)];
    const result = allocateVoices(notes, { maxVoices: 1 });
    expect(result.every((g) => g.voiceIndex === 0)).toBe(true);
  });
});
