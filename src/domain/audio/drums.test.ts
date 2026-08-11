/**
 * Synthesised drum hits with a known answer, the way `pitch-track` is tested
 * with a synthesised tone: a kick is a low decaying sine, a snare is broadband
 * noise, a hat is brief high noise. What is asserted is which drum came back
 * and when — not sample-level detail, which would pin the filter design rather
 * than the behaviour.
 */
import { describe, expect, it } from 'vitest';
import {
  DRUM_HIHAT_CLOSED,
  DRUM_HIHAT_OPEN,
  DRUM_KICK,
  DRUM_SNARE,
  isPercussionNote,
  transcribeDrums,
} from './drums.js';

const SR = 22050;

/** A deterministic noise source — `Math.random` would make failures unrepeatable. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 2147483648) - 1;
  };
}

function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SR));
}

/** Mixes `source` into `buffer` at `atSec`, shaped by an exponential decay. */
function strike(
  buffer: Float32Array,
  atSec: number,
  durationSec: number,
  amplitude: number,
  source: (i: number, sr: number) => number,
): void {
  const start = Math.round(atSec * SR);
  const length = Math.round(durationSec * SR);
  // A 2ms attack rather than a step. Jumping straight to full amplitude is a
  // discontinuity, which is broadband by definition — it put energy in every
  // band at once and had a plain kick reporting a snare alongside it. No
  // physical drum starts that way.
  const attack = Math.round(0.002 * SR);
  for (let i = 0; i < length && start + i < buffer.length; i += 1) {
    const envelope = Math.exp((-5 * i) / length) * Math.min(1, i / attack);
    buffer[start + i] += amplitude * envelope * source(i, SR);
  }
}

const kick = (i: number, sr: number) => Math.sin((2 * Math.PI * 60 * i) / sr);
const snare = (rng: () => number) => (i: number, sr: number) =>
  0.6 * rng() + 0.4 * Math.sin((2 * Math.PI * 220 * i) / sr);
/**
 * A hi-hat is sharply high-passed noise, not plain noise.
 *
 * White noise is flat — as much energy under 120Hz as anywhere else — so using
 * it here made the "hat" trigger the kick and snare bands too, and the failure
 * read as a bug in the classifier rather than in the stimulus. Differencing
 * twice is 12dB/octave, which puts the energy where a cymbal's actually is;
 * differencing once left most of it still in the snare's band.
 */
const hat = (rng: () => number) => {
  let previous = 0;
  let previousShaped = 0;
  return () => {
    const sample = rng();
    const shaped = sample - previous;
    previous = sample;
    const twice = shaped - previousShaped;
    previousShaped = shaped;
    return twice;
  };
};

/** The hits within `toleranceSec` of `atSec`. */
function around(hits: ReturnType<typeof transcribeDrums>, atSec: number, toleranceSec = 0.05) {
  return hits.filter((h) => Math.abs(h.startSec - atSec) <= toleranceSec);
}

describe('transcribeDrums', () => {
  it('hears a kick as a kick', () => {
    const buffer = silence(2);
    strike(buffer, 0.5, 0.15, 0.9, kick);
    strike(buffer, 1.5, 0.15, 0.9, kick);

    const hits = transcribeDrums(buffer, SR);
    expect(around(hits, 0.5).map((h) => h.midi)).toContain(DRUM_KICK);
    expect(around(hits, 1.5).map((h) => h.midi)).toContain(DRUM_KICK);
  });

  it('hears a snare as a snare, not as a kick', () => {
    const buffer = silence(2);
    strike(buffer, 0.5, 0.12, 0.7, snare(noise(7)));

    const hits = around(transcribeDrums(buffer, SR), 0.5);
    expect(hits.map((h) => h.midi)).toContain(DRUM_SNARE);
    expect(hits.map((h) => h.midi)).not.toContain(DRUM_KICK);
  });

  it('hears a short high hit as a closed hi-hat', () => {
    const buffer = silence(2);
    strike(buffer, 0.5, 0.03, 0.5, hat(noise(11)));

    const hits = around(transcribeDrums(buffer, SR), 0.5);
    expect(hits.map((h) => h.midi)).toContain(DRUM_HIHAT_CLOSED);
  });

  it('tells an open hi-hat from a closed one by how long it rings', () => {
    const buffer = silence(2);
    strike(buffer, 0.5, 0.45, 0.5, hat(noise(13)));

    const hits = around(transcribeDrums(buffer, SR), 0.5);
    expect(hits.map((h) => h.midi)).toContain(DRUM_HIHAT_OPEN);
  });

  it('reports a kick and a hat struck together as two hits', () => {
    // Polyphony is the point: a kit plays several drums at once, and a
    // transcription that picked one per instant would drop half the groove.
    const buffer = silence(2);
    strike(buffer, 0.5, 0.15, 0.9, kick);
    strike(buffer, 0.5, 0.03, 0.4, hat(noise(17)));

    const midis = around(transcribeDrums(buffer, SR), 0.5).map((h) => h.midi);
    expect(midis).toContain(DRUM_KICK);
    expect(midis).toContain(DRUM_HIHAT_CLOSED);
  });

  it('does not report a hi-hat under every snare', () => {
    // A snare is broadband, so it puts real energy in the hat band. Without
    // suppressing that, every backbeat comes back with a hat nobody played.
    const buffer = silence(2);
    strike(buffer, 0.5, 0.12, 0.8, snare(noise(19)));

    const midis = around(transcribeDrums(buffer, SR), 0.5).map((h) => h.midi);
    expect(midis).toContain(DRUM_SNARE);
    expect(midis).not.toContain(DRUM_HIHAT_CLOSED);
    expect(midis).not.toContain(DRUM_HIHAT_OPEN);
  });

  it('follows a backbeat pattern, in order and roughly in time', () => {
    // Kick on 1 and 3, snare on 2 and 4, at 120bpm — four bars' worth of beats
    // written into 4 seconds, so all eight strokes fit.
    const buffer = silence(4);
    const beat = 0.5;
    const written: Array<{ midi: number; at: number }> = [];
    for (let bar = 0; bar < 2; bar += 1) {
      const t = bar * beat * 4 + 0.25;
      strike(buffer, t, 0.15, 0.9, kick);
      strike(buffer, t + beat, 0.12, 0.7, snare(noise(23 + bar)));
      strike(buffer, t + beat * 2, 0.15, 0.9, kick);
      strike(buffer, t + beat * 3, 0.12, 0.7, snare(noise(29 + bar)));
      written.push(
        { midi: DRUM_KICK, at: t },
        { midi: DRUM_SNARE, at: t + beat },
        { midi: DRUM_KICK, at: t + beat * 2 },
        { midi: DRUM_SNARE, at: t + beat * 3 },
      );
    }

    const hits = transcribeDrums(buffer, SR).filter(
      (h) => h.midi === DRUM_KICK || h.midi === DRUM_SNARE,
    );
    expect(hits.map((h) => h.midi)).toEqual(written.map((w) => w.midi));
    // And on the beat they were written on, not merely in the right order.
    // 30ms rather than the 50ms `toBeCloseTo(x, 1)` would allow: the analysis
    // window is 46ms long, so a looser bound passes even when every onset is
    // reported a full window early.
    hits.forEach((hit, i) => expect(Math.abs(hit.startSec - written[i].at)).toBeLessThan(0.03));
  });

  it('hears nothing in silence', () => {
    expect(transcribeDrums(silence(2), SR)).toEqual([]);
  });

  it('returns nothing for a buffer too short to frame', () => {
    expect(transcribeDrums(new Float32Array(64), SR)).toEqual([]);
  });

  it('does not retrigger one stroke as several', () => {
    // A decaying hit crosses the threshold on the way up only; its tail is a
    // fall, not a rise.
    const buffer = silence(2);
    strike(buffer, 0.5, 0.4, 0.9, kick);
    expect(around(transcribeDrums(buffer, SR), 0.5, 0.3).filter((h) => h.midi === DRUM_KICK)).toHaveLength(1);
  });

  it('reports louder strokes with higher velocity', () => {
    const buffer = silence(2);
    strike(buffer, 0.5, 0.15, 0.25, kick);
    strike(buffer, 1.2, 0.15, 1.0, kick);

    const kicks = transcribeDrums(buffer, SR).filter((h) => h.midi === DRUM_KICK);
    expect(kicks).toHaveLength(2);
    expect(kicks[1].velocity).toBeGreaterThan(kicks[0].velocity);
  });

  it('only ever emits real General MIDI percussion addresses', () => {
    const buffer = silence(2);
    strike(buffer, 0.4, 0.15, 0.9, kick);
    strike(buffer, 0.8, 0.12, 0.7, snare(noise(31)));
    strike(buffer, 1.2, 0.03, 0.5, hat(noise(37)));

    for (const hit of transcribeDrums(buffer, SR)) expect(isPercussionNote(hit.midi)).toBe(true);
  });
});
