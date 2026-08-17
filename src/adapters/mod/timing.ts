/**
 * Turning a module's two timing knobs into a musical tempo.
 *
 * Pure arithmetic over the parsed cells — no score model, no bytes — so the
 * conversion is testable against known values. Lives in music_lib rather than
 * music_io because it is a musical conversion, not byte handling: the codec
 * returns raw data and the mapping happens here, exactly as MIDI does.
 *
 * `periodToMidi` used to live here and now lives beside the MOD reader in
 * music_io: every other tracker format stores note numbers directly, so the
 * decoder is the only thing that ever sees a period.
 */
import type { TrackerCell } from './types.js';

/** The range a `TempoEvent` may hold; mirrors `domain/validation/validator.ts`. */
const MIN_BPM = 20;
const MAX_BPM = 400;

const DEFAULT_SPEED = 6;
const DEFAULT_TEMPO = 125;

/**
 * Musical BPM from the two knobs.
 *
 * A row is a sixteenth (four to the beat) and a tick lasts 2.5/tempo seconds,
 * so a beat is `4 × speed × 2.5 / tempo` seconds — which reduces to
 * `6 × tempo / speed` beats per minute. At the defaults that is 125, as it
 * should be.
 */
export function effectiveBpm(speed: number, tempo: number): number {
  if (speed <= 0) return DEFAULT_TEMPO;
  // Clamped to what a score can hold. A module is free to set a speed of 1,
  // which at the default tempo works out to 750 BPM — real, and outside the
  // 20-400 the score model accepts, so an unclamped value imports a score the
  // validator rejects outright. A real S3M (modarchive 54606) does exactly
  // this. Clamping keeps the music fast and the score valid; the alternative
  // is a failed import.
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round((6 * tempo) / speed)));
}

export type TempoChange = { row: number; bpm: number };

/** One entry at row 0, then one wherever either knob actually moves. */
export function tempoChanges(rows: readonly TrackerCell[][]): TempoChange[] {
  let speed = DEFAULT_SPEED;
  let tempo = DEFAULT_TEMPO;
  const changes: TempoChange[] = [{ row: 0, bpm: effectiveBpm(speed, tempo) }];

  rows.forEach((cells, row) => {
    let moved = false;
    for (const cell of cells) {
      // Already normalised by the decoder: which effect carries which knob is
      // format knowledge and does not belong here.
      if (cell.speed !== undefined && cell.speed !== 0 && speed !== cell.speed) {
        speed = cell.speed;
        moved = true;
      }
      if (cell.bpm !== undefined && cell.bpm !== 0 && tempo !== cell.bpm) {
        tempo = cell.bpm;
        moved = true;
      }
    }
    // Row 0's entry already exists; only emit again if something moved.
    if (moved && row > 0) changes.push({ row, bpm: effectiveBpm(speed, tempo) });
  });

  return changes;
}
