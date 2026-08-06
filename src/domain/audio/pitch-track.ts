/**
 * Monophonic pitch detection (YIN).
 *
 * Pure over a sample buffer — no Web Audio, no DOM — so it is testable with a
 * synthesised tone and a known answer. Polyphonic material is out of scope by
 * construction: YIN reports one fundamental, and on a chord that is whichever
 * partial happens to dominate.
 */
export type PitchFrame = { timeSec: number; hz: number; confidence: number };

const FRAME = 2048;
const HOP = 512;
/** Roughly C2 to D6 — the range a voice or a single-line instrument occupies. */
const MIN_HZ = 65;
const MAX_HZ = 1200;
/** Below this the frame is treated as unvoiced by callers. */
const THRESHOLD = 0.15;

export function trackPitch(samples: Float32Array, sampleRate: number): PitchFrame[] {
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxTau = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(FRAME / 2));
  const frames: PitchFrame[] = [];

  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    const window = samples.subarray(start, start + FRAME);

    // 1. Difference function.
    const diff = new Float32Array(maxTau + 1);
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      let sum = 0;
      for (let i = 0; i + tau < FRAME; i += 1) {
        const d = window[i] - window[i + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }

    // 2. Cumulative mean normalised difference — what makes YIN robust to
    //    amplitude, and what turns "smallest difference" into a usable score.
    const norm = new Float32Array(maxTau + 1);
    norm[0] = 1;
    let running = 0;
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      running += diff[tau];
      norm[tau] = running === 0 ? 1 : (diff[tau] * (tau - minTau + 1)) / running;
    }

    // 3. First dip below the threshold, else the best available.
    let best = minTau;
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      if (norm[tau] < norm[best]) best = tau;
      if (norm[tau] < THRESHOLD) {
        // Walk to the local minimum rather than taking the first crossing.
        while (tau + 1 <= maxTau && norm[tau + 1] < norm[tau]) tau += 1;
        best = tau;
        break;
      }
    }

    // 4. Parabolic interpolation, so the estimate is not quantised to whole
    //    samples — the difference between 440Hz and 437Hz at this frame size.
    const prev = norm[best - 1] ?? norm[best];
    const next = norm[best + 1] ?? norm[best];
    const denominator = 2 * (2 * norm[best] - prev - next);
    const shift = denominator === 0 ? 0 : (next - prev) / denominator;

    frames.push({
      timeSec: start / sampleRate,
      hz: sampleRate / (best + shift),
      confidence: Math.max(0, Math.min(1, 1 - norm[best])),
    });
  }

  return frames;
}
