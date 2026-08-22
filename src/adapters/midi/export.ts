/**
 * Score -> Standard MIDI File export (spec §16). Pure and read-only: never
 * mutates `score`. `@tonejs/midi` is the designated MIDI library (spec §15)
 * and its use here is an explicitly sanctioned exception to the
 * adapters/services "no non-domain library" purity rule.
 */
import { fermataTempoMap } from '@sudobility/music_types';
import { flattenScoreNotes } from '@sudobility/music_types';
import type {
  MidiCodec,
  MidiFile,
  MidiTimeSignatureEvent,
  MidiTrackData,
  Score,
  TimeSignature,
} from '@sudobility/music_types';

/** General MIDI channel 10 (0-indexed 9), the standard percussion channel. */
const PERCUSSION_CHANNEL = 9;
const CC_VOLUME = 7;
const CC_PAN = 10;
const MIDI_VELOCITY_MAX = 127;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Maps a track's `pan` ([-1, 1], 0 = center) to MIDI CC10's normalized [0, 1] range (0.5 = center). */
function panToNormalized(pan: number): number {
  return clamp01((pan + 1) / 2);
}

/**
 * Distinct `(tick, [numerator, denominator])` time-signature changes,
 * derived from the first track's measures (spec §16 approximation: MIDI
 * has one shared meter timeline, while this app's `Score` technically
 * stores a `timeSignature` per measure per track — in practice every track
 * shares the same meter sequence, so the first track's is authoritative).
 * Falls back to a single 4/4-at-0 entry for a score with no tracks/measures.
 */
function collectTimeSignatureChanges(score: Score): MidiTimeSignatureEvent[] {
  const track = score.tracks[0];
  if (!track || track.measures.length === 0)
    return [{ ticks: 0, timeSignature: [4, 4] }];

  const changes: MidiTimeSignatureEvent[] = [];
  let last: TimeSignature | null = null;
  for (const measure of track.measures) {
    const ts = measure.timeSignature;
    if (
      !last ||
      last.numerator !== ts.numerator ||
      last.denominator !== ts.denominator
    ) {
      changes.push({
        ticks: measure.startTick,
        timeSignature: [ts.numerator, ts.denominator],
      });
      last = ts;
    }
  }
  return changes;
}

/**
 * Exports `score` as a Standard MIDI File byte array: PPQ, tempo map, time
 * signatures, per-track name/program/channel (percussion-clef tracks use
 * channel 9/GM channel 10), notes (with velocity), and volume (CC7) / pan
 * (CC10) set at each track's start. Sustain pedal data isn't part of the
 * internal `Score` model, so none is emitted (spec §16's "sustain where
 * represented" — nothing is represented here yet).
 *
 * **Notes come from `flattenScoreNotes`**, the traversal live playback and
 * offline audio export already share — not from a walk of its own. This used
 * to read the stored events directly, which meant a Standard MIDI File
 * carried none of the score's expression: measured on a passage marked `ff`
 * with accents, the transport played it at velocity 127 and the exported file
 * held 80, the raw stored value. Dynamics, hairpin ramps, articulation weight
 * and shortening, and grace notes were all absent, and ties were the only
 * thing the old walk did rejoin.
 *
 * The tempo map is `fermataTempoMap` for the same reason: a pause is a local
 * slowing, so a file written from the plain map runs straight through every
 * hold. What the file plays is now what the transport just played.
 */
export function exportMidi(score: Score, codec: MidiCodec): Uint8Array {
  // One traversal for the whole file, then split per track: `flattenScoreNotes`
  // resolves ties, dynamics, hairpins, articulations and grace notes together,
  // and re-running it per track would repeat that work for every part.
  const sounding = flattenScoreNotes(score);
  const file: MidiFile = {
    header: {
      name: score.metadata.title,
      ppq: score.ppq,
      tempos: fermataTempoMap(score).map(t => ({ ticks: t.tick, bpm: t.bpm })),
      timeSignatures: collectTimeSignatureChanges(score),
    },
    tracks: score.tracks.map((track): MidiTrackData => ({
      name: track.name,
      channel:
        track.clef === 'percussion' ? PERCUSSION_CHANNEL : track.midiChannel,
      instrument: { number: track.midiProgram },
      notes: sounding
        .filter(note => note.trackId === track.id)
        .map(note => ({
          midi: note.midi,
          ticks: note.tick,
          durationTicks: Math.max(1, note.durTicks),
          velocity: clamp01(note.velocity / MIDI_VELOCITY_MAX),
        })),
      controlChanges: {
        [CC_VOLUME]: [
          { number: CC_VOLUME, ticks: 0, value: clamp01(track.volume) },
        ],
        [CC_PAN]: [
          { number: CC_PAN, ticks: 0, value: panToNormalized(track.pan) },
        ],
      },
      // Durations are outputs of decoding, not inputs to encoding; the codec
      // ignores them here.
      durationTicks: 0,
      durationSeconds: 0,
    })),
    duration: 0,
  };

  return codec.encode(file);
}

/**
 * Slugifies `title` into a filesystem/URL-safe download filename (no
 * extension): lowercase, `[a-z0-9]` runs joined by single hyphens, leading/
 * trailing hyphens trimmed. Falls back to `"untitled"` for a title with no
 * alphanumeric characters at all (empty, whitespace-only, or
 * punctuation-only).
 */
export function safeFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}
