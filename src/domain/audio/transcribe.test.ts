import { describe, expect, it } from 'vitest';
import { transcribe, transcriptionFromHeardNotes } from './transcribe.js';

const SR = 44100;

/** `secondsEach` of `a` followed by `secondsEach` of `b`. */
function twoTones(a: number, b: number, secondsEach: number): Float32Array {
  const n = Math.floor(SR * secondsEach);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) out[i] = Math.sin((2 * Math.PI * a * i) / SR);
  for (let i = 0; i < n; i += 1) out[n + i] = Math.sin((2 * Math.PI * b * i) / SR);
  return out;
}

describe('transcribe', () => {
  it('turns a two-tone recording into two notes in ticks', () => {
    const audio = { samples: twoTones(440, 523.25, 0.5), sampleRate: 44100 };
    const { notes, bpm } = transcribe(audio, 480);
    expect(notes.map((n) => n.midi)).toEqual([69, 72]);
    expect(notes[0].startTick).toBe(0);
    expect(notes[1].startTick).toBeGreaterThan(0);
    expect(bpm).toBeGreaterThanOrEqual(50);
  });

  it('emits ticks against the detected tempo, not a fixed one', () => {
    // Same melody, played twice as fast: the tick positions should match,
    // because the tempo moved with it. This is what makes the detected tempo
    // load-bearing rather than decorative.
    const slow = transcribe({ samples: twoTones(440, 523.25, 0.6), sampleRate: 44100 }, 480);
    const fast = transcribe({ samples: twoTones(440, 523.25, 0.3), sampleRate: 44100 }, 480);
    expect(fast.bpm).toBeGreaterThan(slow.bpm);
  });

  it('produces nothing from silence', () => {
    expect(transcribe({ samples: new Float32Array(44100), sampleRate: 44100 }, 480).notes).toEqual([]);
  });
});

describe('transcriptionFromHeardNotes', () => {
  const heard = (midi: number, startSec: number, durationSec: number) => ({
    midi,
    startSec,
    durationSec,
    amplitude: 0.8,
  });

  it('keeps simultaneous notes simultaneous — a chord stays a chord', () => {
    // The whole point of the polyphonic path. The YIN tracker could only ever
    // report one pitch per frame, so a chord imported as a single note.
    const chord = [heard(60, 0, 1), heard(64, 0, 1), heard(67, 0, 1)];
    const result = transcriptionFromHeardNotes(chord, 480);

    expect(result.notes).toHaveLength(3);
    expect(new Set(result.notes.map((n) => n.startTick)).size).toBe(1);
    expect(result.notes.map((n) => n.midi).sort((a, b) => a - b)).toEqual([60, 64, 67]);
  });

  it('counts a chord as one beat, not three, when detecting tempo', () => {
    // Onsets are de-duplicated first: three notes struck together are one
    // event, and counting each would report a tempo three times too fast.
    const spread = [0, 0.5, 1, 1.5].flatMap((t) => [heard(60, t, 0.4), heard(64, t, 0.4)]);
    expect(transcriptionFromHeardNotes(spread, 480).bpm).toBeCloseTo(120, 0);
  });

  it('never rounds a short note away to nothing', () => {
    const result = transcriptionFromHeardNotes([heard(60, 0, 0.0001)], 480);
    expect(result.notes[0].durationTicks).toBeGreaterThanOrEqual(1);
  });

  it('places notes against the tempo it detected', () => {
    const notes = [heard(60, 0, 0.5), heard(62, 0.5, 0.5), heard(64, 1, 0.5), heard(65, 1.5, 0.5)];
    const result = transcriptionFromHeardNotes(notes, 480);
    const ticksPerSecond = (result.bpm / 60) * 480;
    expect(result.notes[1].startTick).toBe(Math.round(0.5 * ticksPerSecond));
  });
});
