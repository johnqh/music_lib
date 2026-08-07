/**
 * Turning ProTracker's period numbers into pitches, and its two timing knobs
 * into a musical tempo.
 *
 * Pure arithmetic over the parsed cells — no score model, no bytes — so both
 * conversions are testable against known values. Lives in music_lib rather
 * than music_io because these are musical conversions, not byte handling: the
 * codec returns raw data and the mapping happens here, exactly as MIDI does.
 */
import type { ModCell } from './types.js';

/** ProTracker's C-1 period, taken as MIDI 36 (C2). */
const REFERENCE_PERIOD = 856;
const REFERENCE_MIDI = 36;

const DEFAULT_SPEED = 6;
const DEFAULT_TEMPO = 125;
/** Effect F: at or below this the parameter is speed; above it, tempo. */
const SPEED_LIMIT = 0x1f;

/** The pitch a period sounds, or null for "no new note". */
export function periodToMidi(period: number): number | null {
  if (period <= 0) return null;
  return Math.round(REFERENCE_MIDI + 12 * Math.log2(REFERENCE_PERIOD / period));
}

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
  return Math.round((6 * tempo) / speed);
}

export type TempoChange = { row: number; bpm: number };

/** One entry at row 0, then one wherever either knob actually moves. */
export function tempoChanges(rows: readonly ModCell[][]): TempoChange[] {
  let speed = DEFAULT_SPEED;
  let tempo = DEFAULT_TEMPO;
  const changes: TempoChange[] = [{ row: 0, bpm: effectiveBpm(speed, tempo) }];

  rows.forEach((cells, row) => {
    let moved = false;
    for (const cell of cells) {
      if (cell.effect !== 0xf || cell.param === 0) continue;
      if (cell.param <= SPEED_LIMIT) {
        if (speed !== cell.param) { speed = cell.param; moved = true; }
      } else if (tempo !== cell.param) {
        tempo = cell.param;
        moved = true;
      }
    }
    // Row 0's entry already exists; only emit again if something moved.
    if (moved && row > 0) changes.push({ row, bpm: effectiveBpm(speed, tempo) });
  });

  return changes;
}
