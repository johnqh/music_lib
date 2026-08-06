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
 * Tempo from the spacing between note onsets.
 *
 * The median inter-onset interval, folded into a musical range. Median rather
 * than mean because one long held note should not drag the estimate; folding
 * because a run of eighth notes is indistinguishable from quarters at half the
 * tempo, and the musical reading is the one in range.
 */
export function detectTempo(onsetsSec: readonly number[]): number {
  if (onsetsSec.length < 2) return DEFAULT_BPM;

  const gaps = [];
  for (let i = 1; i < onsetsSec.length; i += 1) {
    const gap = onsetsSec[i] - onsetsSec[i - 1];
    if (gap > 0.05) gaps.push(gap);
  }
  if (gaps.length === 0) return DEFAULT_BPM;

  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];

  let bpm = 60 / median;
  while (bpm > MAX_BPM) bpm /= 2;
  while (bpm < MIN_BPM) bpm *= 2;
  return Math.round(bpm);
}
