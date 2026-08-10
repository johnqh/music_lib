import { describe, expect, it } from 'vitest';
import type { MusicalEvent, NoteEvent } from '@sudobility/music_types';
import { displayGridTicks, displayGroups } from './display-timing.js';

const PPQ = 480;
const BAR = PPQ * 4;

let seq = 0;
const note = (startTick: number, durationTicks: number, pitch = 60): NoteEvent =>
  ({
    id: `n${seq++}`,
    startTick,
    durationTicks,
    pitch: { midi: pitch, step: 'C', octave: 4, alter: 0 },
    velocity: 0.8,
    voiceId: 'v',
    trackId: 't',
  }) as unknown as NoteEvent;

const rest = (startTick: number, durationTicks: number): MusicalEvent =>
  ({ id: `r${seq++}`, startTick, durationTicks, voiceId: 'v', trackId: 't' }) as MusicalEvent;

const total = (groups: { durationTicks: number }[]) =>
  groups.reduce((a, g) => a + g.durationTicks, 0);

describe('displayGridTicks', () => {
  it('is a 1/32 note', () => {
    expect(displayGridTicks(480)).toBe(60);
    expect(displayGridTicks(96)).toBe(12);
  });
});

describe('displayGroups', () => {
  it('fills exactly the measure, whatever the recorded durations were', () => {
    // The invariant the whole module exists for: VexFlow accumulates these to
    // build its tick space, and voices that disagree land on different
    // timelines.
    const groups = displayGroups(
      [note(0, 233), note(233, 122), note(355, 618), note(973, 947)],
      0,
      BAR,
      PPQ,
    );
    expect(total(groups)).toBe(BAR);
  });

  it('fills exactly the measure for an already-quantized voice too', () => {
    const groups = displayGroups(
      [note(0, PPQ), note(PPQ, PPQ), note(PPQ * 2, PPQ), note(PPQ * 3, PPQ)],
      0,
      BAR,
      PPQ,
    );
    expect(total(groups)).toBe(BAR);
    expect(groups.map((g) => g.durationTicks)).toEqual([PPQ, PPQ, PPQ, PPQ]);
  });

  it('leaves a quantized voice on its original onsets', () => {
    // The safety property: this must not move notes that were already drawable.
    const groups = displayGroups([note(0, PPQ * 2), note(PPQ * 2, PPQ * 2)], 0, BAR, PPQ);
    expect(groups.map((g) => g.durationTicks)).toEqual([PPQ * 2, PPQ * 2]);
  });

  it('gives every duration as a whole number of grid steps', () => {
    // Anything else would be rounded by ticksToVexDuration, which is the drift.
    const groups = displayGroups(
      [note(3, 117), note(120, 3), note(123, 1000), note(1113, 800)],
      0,
      BAR,
      PPQ,
    );
    for (const g of groups) expect(g.durationTicks % displayGridTicks(PPQ)).toBe(0);
  });

  it('draws notes struck a few ticks apart as one chord', () => {
    // A rolled chord recorded 3 ticks apart was three consecutive notes that
    // between them overran the bar.
    const groups = displayGroups([note(0, 480, 60), note(3, 477, 64), note(5, 475, 67)], 0, BAR, PPQ);
    expect(groups).toHaveLength(1);
    expect(groups[0].events).toHaveLength(3);
    expect(groups[0].durationTicks).toBe(BAR);
  });

  it('works in measure-relative space, so later measures are not misplaced', () => {
    const start = BAR * 7;
    const groups = displayGroups([note(start, PPQ), note(start + PPQ, PPQ * 3)], start, BAR, PPQ);
    expect(groups.map((g) => g.durationTicks)).toEqual([PPQ, PPQ * 3]);
    expect(total(groups)).toBe(BAR);
  });

  it('keeps the note when a rest snaps onto the same step', () => {
    // Drawing a rest through a sounding note is worse than dropping a silence
    // that turned out shorter than the grid.
    const groups = displayGroups([rest(0, 5), note(5, BAR - 5)], 0, BAR, PPQ);
    expect(groups).toHaveLength(1);
    expect(groups[0].events.every((e) => 'pitch' in e)).toBe(true);
  });

  it('never emits a zero-length tickable for an event at the barline', () => {
    const groups = displayGroups([note(0, BAR - 2), note(BAR - 2, 2)], 0, BAR, PPQ);
    expect(total(groups)).toBe(BAR);
    for (const g of groups) expect(g.durationTicks).toBeGreaterThan(0);
  });

  it('returns nothing for an empty voice', () => {
    expect(displayGroups([], 0, BAR, PPQ)).toEqual([]);
  });
});
