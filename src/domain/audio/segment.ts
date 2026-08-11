/**
 * Turning pitch frames into notes, and note onsets into a tempo.
 *
 * Pure over the frames — no audio, no DOM — so both halves are testable with
 * hand-built input and a known answer.
 */
import type { PitchFrame } from './pitch-track.js';

export type DetectedNote = { startSec: number; endSec: number; midi: number };

/** Below this a frame is unvoiced: breath, room tone, the tail of a note. */
const MIN_CONFIDENCE = 0.6;
/** Shorter than this is a blip, not a note. */
const MIN_NOTE_SEC = 0.05;

const hzToMidi = (hz: number): number => Math.round(69 + 12 * Math.log2(hz / 440));

export function segmentNotes(frames: readonly PitchFrame[]): DetectedNote[] {
  const notes: DetectedNote[] = [];
  let current: { midi: number; startSec: number; endSec: number } | null = null;

  const flush = (): void => {
    if (current && current.endSec - current.startSec >= MIN_NOTE_SEC) notes.push({ ...current });
    current = null;
  };

  for (const f of frames) {
    if (f.confidence < MIN_CONFIDENCE || f.hz <= 0) {
      flush();
      continue;
    }
    const midi = hzToMidi(f.hz);
    if (!current || current.midi !== midi) {
      flush();
      current = { midi, startSec: f.timeSec, endSec: f.timeSec };
    } else {
      current.endSec = f.timeSec;
    }
  }
  flush();
  return notes;
}

const MIN_BPM = 50;
const MAX_BPM = 200;
const DEFAULT_BPM = 120;

/**
 * Seconds of onsets scored as one phase-coherent block.
 *
 * Long enough to hold several bars at any tempo in range, short enough that a
 * performance drifting over minutes does not cancel itself out — each window
 * carries its own phase, so a gradual change moves the windows rather than
 * blurring one global sum.
 */
const WINDOW_SEC = 12;
const WINDOW_MIN_ONSETS = 4;

/**
 * The tempo prior: a log-normal over BPM, in octaves.
 *
 * Onsets on a beat also sit on every faster grid that divides it, so phase
 * coherence alone cannot tell 114 from 228 — it scores both. Something has to
 * break that tie, and "nearer a walking pace" is what a listener uses.
 */
const PRIOR_CENTER_BPM = 120;
const PRIOR_WIDTH_OCTAVES = 0.9;

/**
 * How finely the range is swept.
 *
 * Half a bpm, for a result that is rounded to a whole one. A refinement pass at
 * 0.05 was tried and removed: on the real recording it moved the answer from
 * 114 to 113, because at this resolution the score surface is rough and a finer
 * search finds noise beside the peak rather than the peak.
 */
const STEP_BPM = 0.5;

/**
 * Half-open `[from, to)` index pairs, one per window.
 *
 * Found once and reused for every candidate tempo. Rescanning the onsets per
 * window per tempo instead is what made a 12-minute import cost 465ms of frozen
 * main thread, for an answer that does not depend on the tempo being tried.
 */
function windowRanges(onsets: readonly number[]): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  const step = WINDOW_SEC / 2;
  let from = 0;
  for (let start = onsets[0]; start < onsets[onsets.length - 1]; start += step) {
    while (from < onsets.length && onsets[from] < start) from += 1;
    let to = from;
    while (to < onsets.length && onsets[to] < start + WINDOW_SEC) to += 1;
    if (to - from >= WINDOW_MIN_ONSETS) ranges.push([from, to]);
  }
  // Too few onsets to fill a window: score the lot as one.
  return ranges.length > 0 ? ranges : [[0, onsets.length]];
}

/**
 * How strongly onsets cluster at one phase of a beat this long, 0..1.
 *
 * The onsets are treated as unit vectors around the beat's circle and summed:
 * all on the beat point the same way and the sum is 1, spread evenly around it
 * and they cancel to 0. Summing *vectors* is what makes this independent of
 * where the first beat falls, so no downbeat has to be found first.
 *
 * Averaged over overlapping windows rather than taken across the whole
 * recording, so the answer survives a tempo that drifts.
 */
function beatCoherence(
  onsets: readonly number[],
  ranges: ReadonlyArray<readonly [number, number]>,
  bpm: number,
): number {
  const scale = (2 * Math.PI * bpm) / 60;

  let total = 0;
  for (const [from, to] of ranges) {
    let re = 0;
    let im = 0;
    for (let i = from; i < to; i += 1) {
      const angle = onsets[i] * scale;
      re += Math.cos(angle);
      im += Math.sin(angle);
    }
    total += Math.hypot(re, im) / (to - from);
  }
  return total / ranges.length;
}

/** Favours a walking pace, so a beat and its double do not tie. */
function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / PRIOR_CENTER_BPM) / PRIOR_WIDTH_OCTAVES;
  return Math.exp(-0.5 * octaves * octaves);
}

/**
 * Tempo from the spacing between note onsets.
 *
 * Scores every tempo in range by how well the onsets line up to a beat that
 * long, and takes the best. It replaced the median inter-onset interval, which
 * assumed the commonest gap *is* the beat — true only when nothing but beats is
 * played. Real music subdivides, so the median gap lands on whichever
 * subdivision is most common and the estimate comes out a multiple of the truth.
 * Folding into range only repairs that when the multiple is a power of two: on a
 * real pop mix the median gap was a sixteenth, giving 517bpm, and halving into
 * range landed on 129 against a true 114.
 *
 * Alignment is the right question because a beat explains its own subdivisions —
 * onsets on eighths and sixteenths still sit on the beat's grid — while a wrong
 * tempo explains almost nothing.
 */
export function detectTempo(onsetsSec: readonly number[]): number {
  // Sorted because the window scan walks them in order and stops at its end.
  // A chord's notes arriving a few ms apart need no special handling: they land
  // at the same phase and reinforce that instant rather than reading as an
  // interval, which is the one thing the old gap-based method could not do.
  const onsets = [...onsetsSec].sort((a, b) => a - b);
  if (onsets.length < 2) return DEFAULT_BPM;
  const ranges = windowRanges(onsets);

  let bestBpm = DEFAULT_BPM;
  let bestScore = -1;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += STEP_BPM) {
    const score = beatCoherence(onsets, ranges, bpm) * tempoPrior(bpm);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }
  return Math.round(bestBpm);
}
