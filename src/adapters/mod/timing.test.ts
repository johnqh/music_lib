import { describe, expect, it } from 'vitest';
import { effectiveBpm, tempoChanges } from './timing.js';
import type { TrackerCell } from './types.js';

describe('effectiveBpm', () => {
  it('is 125 at the defaults', () => {
    expect(effectiveBpm(6, 125)).toBe(125);
  });

  it('doubles when speed halves', () => {
    // Fewer ticks per row means rows go by faster — the common case in fills.
    expect(effectiveBpm(3, 125)).toBe(250);
  });

  it('follows the tempo knob too', () => {
    expect(effectiveBpm(3, 100)).toBe(200);
  });
});

describe('tempoChanges', () => {
  // The decoder normalises effect F into these two fields, so tempo reading
  // never sees an effect number.
  const cell = (knobs: { speed?: number; bpm?: number } = {}): TrackerCell => ({
    instrument: 0,
    note: null,
    ...knobs,
  });

  it('starts at the defaults', () => {
    expect(tempoChanges([[cell()]])).toEqual([{ row: 0, bpm: 125 }]);
  });

  it('emits a change when speed is set', () => {
    // F03 = speed 3.
    const changes = tempoChanges([[cell()], [cell({ speed: 0x03 })]]);
    expect(changes).toEqual([
      { row: 0, bpm: 125 },
      { row: 1, bpm: 250 },
    ]);
  });

  it('emits a change when tempo is set', () => {
    // F64 = tempo 100 (0x64 >= 0x20, so it is the BPM knob).
    const changes = tempoChanges([[cell()], [cell({ bpm: 0x64 })]]);
    expect(changes[1]).toEqual({ row: 1, bpm: 100 });
  });

  it('carries speed and tempo forward together', () => {
    const changes = tempoChanges([[cell()], [cell({ speed: 0x03 })], [cell({ bpm: 0x64 })]]);
    expect(changes[2]).toEqual({ row: 2, bpm: 200 });
  });

  it('does not emit a change when the value is unchanged', () => {
    // A redundant tempo event per row would bloat the map for nothing.
    expect(tempoChanges([[cell()], [cell({ speed: 0x06 })]])).toHaveLength(1);
  });
});

describe('effectiveBpm: staying inside what a score can hold', () => {
  it('clamps a speed of 1, which works out to 750 bpm', () => {
    // A real S3M (modarchive 54606) sets speed 1. Unclamped this imports a
    // score the validator rejects with `invalid-tempo-bpm`.
    expect(effectiveBpm(1, 125)).toBe(400);
  });

  it('clamps a tempo far below the range', () => {
    expect(effectiveBpm(31, 32)).toBe(20);
  });

  it('leaves an ordinary tempo alone', () => {
    expect(effectiveBpm(6, 125)).toBe(125);
  });
});
