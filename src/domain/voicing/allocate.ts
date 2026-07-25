/**
 * Basic voice allocation (spec §25): groups simultaneous notes into
 * chords, separates overlapping independent lines into separate voices
 * (preferring minimal voice-hopping), respects a configurable maximum
 * voice count, and assigns notes to a treble/bass staff by pitch for
 * grand-staff tracks. Output need not match professional engraving, but
 * must be readable; a caller may reassign manually afterward. Pure
 * function: never mutates `notes`.
 */
import { pitchToMidi } from '../pitch/pitch.js';
import type { NoteEvent } from '@sudobility/music_types';

const DEFAULT_SPLIT_POINT = 60; // middle C

export type AllocateVoicesOptions = { maxVoices: number; splitPoint?: number };

export type VoiceGroup = { voiceIndex: number; staff: 'upper' | 'lower'; notes: NoteEvent[] };

/**
 * Groups `notes` into chronological clusters of notes sharing the exact
 * same `startTick` *and* `durationTicks` — "simultaneous, equal-duration"
 * per spec §25, since only such notes can be notated as one chord. Two
 * simultaneous notes of differing duration are deliberately kept as
 * separate one-note clusters (they can't share a single notated value).
 * Clusters are returned in ascending `startTick` order.
 */
function groupChordClusters(notes: NoteEvent[]): NoteEvent[][] {
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick);
  const order: string[] = [];
  const byKey = new Map<string, NoteEvent[]>();

  for (const note of sorted) {
    const key = `${note.startTick}:${note.durationTicks}`;
    let cluster = byKey.get(key);
    if (!cluster) {
      cluster = [];
      byKey.set(key, cluster);
      order.push(key);
    }
    cluster.push(note);
  }

  return order.map((key) => byKey.get(key) as NoteEvent[]);
}

/** Mutable voice-assignment tracking used only within `allocateVoices`. */
type VoiceSlot = { lastEnd: number; notes: NoteEvent[] };

/**
 * The index of the best voice slot for a cluster starting at `startTick`:
 * among slots free at or before `startTick` (no overlap), the one whose
 * `lastEnd` is largest — i.e. whose previous note ended closest before the
 * new one, minimizing voice-hopping. Opens a fresh slot if none are free
 * and the voice cap hasn't been reached (or none exist yet). Otherwise
 * (at capacity, all busy) reuses the least-overlapping slot (largest
 * `lastEnd`) rather than exceeding `maxVoices`.
 */
function chooseVoiceIndex(voices: VoiceSlot[], startTick: number, maxVoices: number): number {
  let bestFreeIndex = -1;
  for (let i = 0; i < voices.length; i += 1) {
    if (voices[i].lastEnd <= startTick) {
      if (bestFreeIndex === -1 || voices[i].lastEnd > voices[bestFreeIndex].lastEnd) {
        bestFreeIndex = i;
      }
    }
  }
  if (bestFreeIndex !== -1) return bestFreeIndex;

  if (voices.length === 0 || voices.length < maxVoices) {
    return voices.length; // caller pushes a fresh slot at this index
  }

  let leastOverlapIndex = 0;
  for (let i = 1; i < voices.length; i += 1) {
    if (voices[i].lastEnd > voices[leastOverlapIndex].lastEnd) leastOverlapIndex = i;
  }
  return leastOverlapIndex;
}

/**
 * Allocates `notes` into voices (rhythm/overlap-based) and staves
 * (pitch-based). A wide chord straddling `splitPoint` (or grand-staff
 * tracks generally) can produce two output groups for the same
 * `voiceIndex` — one per staff — since staff assignment is per-note while
 * voice assignment is per-cluster.
 */
export function allocateVoices(notes: NoteEvent[], opts: AllocateVoicesOptions): VoiceGroup[] {
  if (notes.length === 0) return [];

  const splitPoint = opts.splitPoint ?? DEFAULT_SPLIT_POINT;
  const clusters = groupChordClusters(notes);
  const voices: VoiceSlot[] = [];

  for (const cluster of clusters) {
    const startTick = cluster[0].startTick;
    const endTick = cluster[0].startTick + cluster[0].durationTicks;

    const index = chooseVoiceIndex(voices, startTick, opts.maxVoices);
    if (!voices[index]) voices[index] = { lastEnd: -Infinity, notes: [] };

    voices[index].notes.push(...cluster);
    voices[index].lastEnd = Math.max(voices[index].lastEnd, endTick);
  }

  const result: VoiceGroup[] = [];
  voices.forEach((voice, voiceIndex) => {
    const upper = voice.notes.filter((n) => pitchToMidi(n.pitch) >= splitPoint);
    const lower = voice.notes.filter((n) => pitchToMidi(n.pitch) < splitPoint);
    if (upper.length > 0) result.push({ voiceIndex, staff: 'upper', notes: upper });
    if (lower.length > 0) result.push({ voiceIndex, staff: 'lower', notes: lower });
  });

  return result;
}
