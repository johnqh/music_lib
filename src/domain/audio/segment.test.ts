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

  it('reads the beat, not the subdivision, when both are played', () => {
    // 100bpm (0.6s), every beat plus a syncopated hit three quarters through it.
    // The commonest gap is 0.15s, so reading the gap as the beat gives 400 and
    // halving lands on 200 — in range, and wrong by an octave.
    //
    // Syncopated rather than a plain off-beat eighth on purpose: with an onset
    // on every eighth and no accent, "eighths at 100" and "quarters at 200"
    // describe the same sound, and no method reading onset times alone can
    // prefer one. This pattern has an answer to get right.
    const beat = 0.6;
    const onsets: number[] = [];
    for (let i = 0; i < 32; i += 1) onsets.push(i * beat, i * beat + beat * 0.75);
    expect(detectTempo(onsets)).toBeCloseTo(100, -0.5);
  });

  it('reads a slow pulse at a walking pace rather than its slowest valid reading', () => {
    // Onsets every 1.2s sit exactly on a 50, 100, 150 and 200bpm grid alike, so
    // alignment cannot choose between them — every one of them explains all of
    // the onsets. What breaks the tie is that music is counted near a walking
    // pace, and 50 is the answer a bare argmax would reach for first.
    const onsets = Array.from({ length: 24 }, (_, i) => i * 1.2);
    const bpm = detectTempo(onsets);
    expect(bpm).toBeGreaterThan(90);
    expect(bpm).toBeLessThanOrEqual(160);
  });

  it('is not thrown by a chord arriving as several onsets a few ms apart', () => {
    // A polyphonic model reports each note of a chord separately, milliseconds
    // apart. Those gaps are not musical intervals and must not become the beat.
    const beat = 0.5;
    const onsets: number[] = [];
    for (let i = 0; i < 24; i += 1) onsets.push(i * beat, i * beat + 0.011, i * beat + 0.023);
    expect(detectTempo(onsets)).toBeCloseTo(120, -0.5);
  });

  it('reports the average tempo of a performance that drifts, either way', () => {
    // Two minutes sliding between 100 and 108bpm — an unclicked performance,
    // and the length of an import rather than a clip. The mean is 104 both
    // ways round, and that is what should come back.
    //
    // Scored as one span instead of windows the answer is 106 in both
    // directions: phase accumulates across the whole recording, so the drift
    // biases the estimate rather than averaging out. Windows each carry their
    // own phase, which is what removes the bias.
    const drift = (from: number, to: number): number[] => {
      const onsets: number[] = [];
      let t = 0;
      for (let i = 0; i < 200; i += 1) {
        onsets.push(t);
        t += 60 / (from + ((to - from) * i) / 200);
      }
      return onsets;
    };

    expect(detectTempo(drift(100, 108))).toBe(104);
    expect(detectTempo(drift(108, 100))).toBe(104);
  });

  /**
   * Onsets Basic Pitch actually heard in 15s of a commercial pop mix, whose
   * published tempo is 114bpm. Real rather than synthesised because the way
   * this went wrong is a property of real music: the median gap here is 0.116s
   * — a sixteenth — so reading it as the beat gave 517bpm, and halving into
   * range landed on 129. Folding by twos cannot undo a 4.5x error.
   */
  it('recovers the tempo of a real recording, where the median gap does not', () => {
    // prettier-ignore
    const onsets = [
      0, 0.023, 0.047, 0.256, 0.349, 0.453, 0.523, 0.604, 0.674, 0.685, 0.883, 0.987,
      1.068, 1.173, 1.184, 1.196, 1.335, 1.347, 1.428, 1.44, 1.568, 1.695, 1.718, 1.777,
      1.869, 1.987, 2.103, 2.115, 2.138, 2.207, 2.335, 2.347, 2.393, 2.463, 2.486, 2.66,
      2.718, 2.73, 2.811, 3.171, 3.252, 3.45, 3.705, 3.81, 3.833, 3.937, 4.229, 4.252,
      4.345, 4.391, 4.716, 5.03, 5.355, 5.413, 5.494, 5.599, 5.912, 5.937, 5.948, 6.076,
      6.099, 6.169, 6.285, 6.332, 6.355, 6.378, 6.471, 6.494, 6.564, 6.715, 6.831, 6.854,
      6.877, 6.924, 7.051, 7.237, 7.365, 7.493, 7.504, 7.643, 7.713, 7.783, 7.91, 8.028,
      8.039, 8.179, 8.318, 8.457, 8.574, 8.608, 8.666, 8.852, 8.922, 8.957, 8.968, 9.003,
      9.05, 9.502, 9.549, 9.572, 9.618, 9.711, 9.735, 9.851, 9.874, 9.98, 9.991, 10.014,
      10.131, 10.247, 10.281, 10.479, 10.502, 10.548, 10.63, 10.665, 10.676, 10.769, 10.816, 10.885,
      10.908, 11.083, 11.164, 11.233, 11.547, 11.605, 11.628, 11.733, 11.86, 11.872, 12.117, 12.21,
      12.233, 12.256, 12.349, 12.582, 12.651, 12.674, 12.698, 12.744, 12.767, 12.802, 13.081, 13.104,
      13.174, 13.255, 13.29, 13.789, 13.824, 13.918, 13.999, 14.127, 14.313, 14.359, 14.382, 14.498,
      14.545, 14.603, 14.742, 14.754, 14.777, 14.812, 14.905, 14.974,
    ];

    // The published tempo, exactly. Pinned rather than bracketed because this
    // is a pure function over a fixed list: anything that moves it is a change
    // in behaviour worth looking at, and the old method's answer was 129.
    expect(detectTempo(onsets)).toBe(114);
  });
});
