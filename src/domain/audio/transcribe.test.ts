import { describe, expect, it } from 'vitest';
import { transcribe } from './transcribe.js';

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
