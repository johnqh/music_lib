import { describe, expect, it } from 'vitest';
import { detectTempo, segmentNotes } from './segment.js';

const frame = (timeSec: number, hz: number, confidence = 0.95) => ({ timeSec, hz, confidence });
/** `count` frames at `hz` starting at `from`, one every 512/44100s. */
function run(from: number, hz: number, count: number, confidence = 0.95) {
  const step = 512 / 44100;
  return Array.from({ length: count }, (_, i) => frame(from + i * step, hz, confidence));
}

describe('segmentNotes', () => {
  it('turns a stable run of frames into one note', () => {
    const notes = segmentNotes(run(0, 440, 40));
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(69);
  });

  it('splits when the pitch changes', () => {
    const notes = segmentNotes([...run(0, 440, 30), ...run(0.35, 523.25, 30)]);
    expect(notes.map((n) => n.midi)).toEqual([69, 72]);
  });

  it('ignores frames below the confidence floor', () => {
    // Breath and room noise, which would otherwise become grace notes.
    expect(segmentNotes(run(0, 440, 40, 0.1))).toHaveLength(0);
  });

  it('ends a note at a gap of silence', () => {
    const notes = segmentNotes([...run(0, 440, 30), ...run(0.35, 440, 30, 0.05), ...run(0.7, 440, 30)]);
    expect(notes).toHaveLength(2);
  });

  it('discards a blip too short to be a note', () => {
    expect(segmentNotes(run(0, 440, 2))).toHaveLength(0);
  });
});

describe('detectTempo', () => {
  it('recovers a tempo from evenly spaced onsets', () => {
    // 120bpm quarter notes are 0.5s apart.
    const onsets = Array.from({ length: 9 }, (_, i) => i * 0.5);
    expect(detectTempo(onsets)).toBeCloseTo(120, 0);
  });

  it('folds an out-of-range result into a musical one', () => {
    // 0.15s apart is 400bpm; the musical reading is 200.
    const onsets = Array.from({ length: 9 }, (_, i) => i * 0.15);
    const bpm = detectTempo(onsets);
    expect(bpm).toBeGreaterThanOrEqual(50);
    expect(bpm).toBeLessThanOrEqual(200);
  });

  it('falls back to 120 when there is nothing to go on', () => {
    expect(detectTempo([])).toBe(120);
    expect(detectTempo([1])).toBe(120);
  });

  it('survives an uneven performance', () => {
    // Roughly 100bpm with human wobble; the answer should be near it, not wild.
    const onsets = [0, 0.61, 1.18, 1.82, 2.39, 3.02];
    const bpm = detectTempo(onsets);
    expect(bpm).toBeGreaterThan(80);
    expect(bpm).toBeLessThan(120);
  });
});
