import { describe, expect, it } from 'vitest';
import { TempoMap } from './tempo-map';

const PPQ = 480;

describe('TempoMap', () => {
  it('defaults to 120 bpm when the event list is empty', () => {
    const map = new TempoMap([], PPQ);
    expect(map.bpmAt(0)).toBe(120);
    expect(map.bpmAt(10_000)).toBe(120);
  });

  it('converts ticks to seconds at the default 120 bpm', () => {
    const map = new TempoMap([], PPQ);
    // one quarter note at 120bpm = 0.5s
    expect(map.ticksToSeconds(PPQ)).toBeCloseTo(0.5);
    // one whole note at 120bpm = 2s
    expect(map.ticksToSeconds(4 * PPQ)).toBeCloseTo(2);
  });

  it('converts seconds to ticks at the default 120 bpm', () => {
    const map = new TempoMap([], PPQ);
    expect(map.secondsToTicks(0.5)).toBeCloseTo(PPQ);
  });

  it('applies a tempo change from its tick until the next event', () => {
    const map = new TempoMap(
      [
        { id: 'a', tick: 0, bpm: 120 },
        { id: 'b', tick: 4 * PPQ, bpm: 60 },
      ],
      PPQ,
    );

    expect(map.bpmAt(0)).toBe(120);
    expect(map.bpmAt(4 * PPQ - 1)).toBe(120);
    expect(map.bpmAt(4 * PPQ)).toBe(60);
    expect(map.bpmAt(4 * PPQ + 1)).toBe(60);
  });

  it('accumulates seconds correctly across a tempo change', () => {
    const map = new TempoMap(
      [
        { id: 'a', tick: 0, bpm: 120 },
        { id: 'b', tick: 4 * PPQ, bpm: 60 },
      ],
      PPQ,
    );

    // first whole note at 120bpm = 2s
    expect(map.ticksToSeconds(4 * PPQ)).toBeCloseTo(2);
    // + one more whole note at 60bpm = 4s -> total 6s
    expect(map.ticksToSeconds(8 * PPQ)).toBeCloseTo(6);
  });

  it('applies the default 120 bpm before the first event when it does not start at tick 0', () => {
    const map = new TempoMap([{ id: 'a', tick: 2 * PPQ, bpm: 200 }], PPQ);

    // two quarters at default 120bpm = 1s
    expect(map.ticksToSeconds(2 * PPQ)).toBeCloseTo(1);
    // + one quarter at 200bpm = 0.3s -> total 1.3s
    expect(map.ticksToSeconds(3 * PPQ)).toBeCloseTo(1.3);
  });

  it('sorts unsorted events by tick before use', () => {
    const sorted = new TempoMap(
      [
        { id: 'a', tick: 0, bpm: 120 },
        { id: 'b', tick: 4 * PPQ, bpm: 60 },
      ],
      PPQ,
    );
    const unsorted = new TempoMap(
      [
        { id: 'b', tick: 4 * PPQ, bpm: 60 },
        { id: 'a', tick: 0, bpm: 120 },
      ],
      PPQ,
    );

    expect(unsorted.ticksToSeconds(8 * PPQ)).toBeCloseTo(sorted.ticksToSeconds(8 * PPQ));
  });

  it('extrapolates past the last tempo event using its bpm', () => {
    const map = new TempoMap([{ id: 'a', tick: 0, bpm: 60 }], PPQ);
    // 8 quarters at 60bpm = 8s
    expect(map.ticksToSeconds(8 * PPQ)).toBeCloseTo(8);
  });

  it('round-trips ticksToSeconds and secondsToTicks across multiple tempo events', () => {
    const map = new TempoMap(
      [
        { id: 'a', tick: 0, bpm: 120 },
        { id: 'b', tick: 4 * PPQ, bpm: 90 },
        { id: 'c', tick: 10 * PPQ, bpm: 150 },
      ],
      PPQ,
    );

    for (const tick of [0, 100, 4 * PPQ, 4 * PPQ + 500, 10 * PPQ, 12 * PPQ]) {
      const seconds = map.ticksToSeconds(tick);
      expect(map.secondsToTicks(seconds)).toBeCloseTo(tick, 5);
    }
  });
});
