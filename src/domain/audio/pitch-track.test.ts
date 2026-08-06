import { describe, expect, it } from 'vitest';
import { trackPitch } from './pitch-track.js';

const SR = 44100;

/** `seconds` of a sine at `hz`. */
function tone(hz: number, seconds: number, sampleRate = SR): Float32Array {
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

describe('trackPitch', () => {
  it('finds the fundamental of a pure tone', () => {
    // The whole feature rests on this being right, so it is asserted in Hz
    // rather than by anything downstream.
    const frames = trackPitch(tone(440, 0.5), SR).filter((f) => f.confidence > 0.8);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(Math.abs(frame.hz - 440)).toBeLessThan(5);
  });

  it('follows a change of pitch', () => {
    const a = tone(220, 0.4);
    const b = tone(330, 0.4);
    const both = new Float32Array(a.length + b.length);
    both.set(a, 0);
    both.set(b, a.length);

    const frames = trackPitch(both, SR).filter((f) => f.confidence > 0.8);
    expect(frames[0].hz).toBeCloseTo(220, -1);
    expect(frames[frames.length - 1].hz).toBeCloseTo(330, -1);
  });

  it('reports low confidence for silence', () => {
    // The floor that stops breath noise becoming a run of grace notes.
    const frames = trackPitch(new Float32Array(SR / 2), SR);
    expect(frames.every((f) => f.confidence < 0.5)).toBe(true);
  });

  it('reports low confidence for white noise', () => {
    const noise = new Float32Array(SR / 2);
    // A real LCG with a ~2^31 period. An earlier version of this fixture used
    // `(i * a + c) % 2000`, which is *periodic* over a couple of thousand
    // samples — YIN found its pitch, correctly, and the test failed. Noise has
    // to actually be aperiodic for this assertion to mean anything.
    let seed = 12345;
    for (let i = 0; i < noise.length; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      noise[i] = (seed / 2147483648) * 2 - 1;
    }
    const confident = trackPitch(noise, SR).filter((f) => f.confidence > 0.9);
    expect(confident.length).toBeLessThan(noise.length / 4410);
  });

  it('timestamps frames in seconds', () => {
    const frames = trackPitch(tone(440, 1), SR);
    expect(frames[0].timeSec).toBe(0);
    expect(frames[frames.length - 1].timeSec).toBeGreaterThan(0.8);
  });
});
