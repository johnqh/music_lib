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

/**
 * How often progress is reported, in frames.
 *
 * Every frame would be thousands of calls for a short clip — each one a
 * `postMessage` when this runs in a worker — for a bar that cannot move by a
 * visible amount between them. Every 32 frames is roughly a percent on a
 * ten-second recording and far less work.
 */
const PROGRESS_EVERY = 32;

export function trackPitch(
  samples: Float32Array,
  sampleRate: number,
  /**
   * Reports how much of the buffer has been analysed, 0..1.
   *
   * This loop is the whole cost of transcribing — O(frames x tau x window) —
   * and on a real recording it runs for seconds. It cannot yield (a tight
   * numeric loop is the point), so a caller that wants to *show* the progress
   * has to run it off the main thread; see `workers/transcribe.worker.ts`.
   */
  onProgress?: (fraction: number) => void,
): PitchFrame[] {
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxTau = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(FRAME / 2));
  const frames: PitchFrame[] = [];
  const lastStart = samples.length - FRAME;
  const totalFrames = lastStart < 0 ? 0 : Math.floor(lastStart / HOP) + 1;

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

    if (onProgress && frames.length % PROGRESS_EVERY === 0 && totalFrames > 0) {
      onProgress(frames.length / totalFrames);
    }
  }

  // Always a final 1: the loop reports on a stride, so the last partial batch
  // would otherwise leave the bar short of the end for the whole of the work
  // that follows it.
  onProgress?.(1);
  return frames;
}
