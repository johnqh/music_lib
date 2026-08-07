import { describe, expect, it } from 'vitest';
import { effectiveBpm, periodToMidi, tempoChanges } from './timing.js';

describe('periodToMidi', () => {
  it('maps the reference period to C2', () => {
    // Amiga period 856 is ProTracker's C-1, taken here as MIDI 36.
    expect(periodToMidi(856)).toBe(36);
  });

  it('maps an octave up to twelve semitones up', () => {
    // Halving the period raises the pitch an octave, by definition.
    expect(periodToMidi(428)).toBe(48);
    expect(periodToMidi(214)).toBe(60);
  });

  it('maps a semitone step', () => {
    expect(periodToMidi(808)).toBe(37);
  });

  it('reports no note for period 0', () => {
    expect(periodToMidi(0)).toBeNull();
  });
});

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
  const cell = (effect = 0, param = 0) => ({ sample: 0, period: 0, effect, param });

  it('starts at the defaults', () => {
    expect(tempoChanges([[cell()]])).toEqual([{ row: 0, bpm: 125 }]);
  });

  it('emits a change when speed is set', () => {
    // F03 = speed 3.
    const changes = tempoChanges([[cell()], [cell(0xf, 0x03)]]);
    expect(changes).toEqual([
      { row: 0, bpm: 125 },
      { row: 1, bpm: 250 },
    ]);
  });

  it('emits a change when tempo is set', () => {
    // F64 = tempo 100 (0x64 >= 0x20, so it is the BPM knob).
    const changes = tempoChanges([[cell()], [cell(0xf, 0x64)]]);
    expect(changes[1]).toEqual({ row: 1, bpm: 100 });
  });

  it('carries speed and tempo forward together', () => {
    const changes = tempoChanges([[cell()], [cell(0xf, 0x03)], [cell(0xf, 0x64)]]);
    expect(changes[2]).toEqual({ row: 2, bpm: 200 });
  });

  it('does not emit a change when the value is unchanged', () => {
    // A redundant tempo event per row would bloat the map for nothing.
    expect(tempoChanges([[cell()], [cell(0xf, 0x06)]])).toHaveLength(1);
  });
});
