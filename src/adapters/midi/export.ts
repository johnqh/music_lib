/**
 * Score -> Standard MIDI File export (spec §16). Pure and read-only: never
 * mutates `score`. `@tonejs/midi` is the designated MIDI library (spec §15)
 * and its use here is an explicitly sanctioned exception to the
 * adapters/services "no non-domain library" purity rule.
 */
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import { joinTiedNotes } from '../../domain/score/ties.js';
import type {
  MidiCodec,
  MidiFile,
  MidiTimeSignatureEvent,
  MidiTrackData,
  MusicalEvent,
  NoteEvent,
  Score,
  TimeSignature,
  Track,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';

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

/** The most voices any single measure of `track` has (so every "voice channel" ordinal position is covered). */
function maxVoiceCount(track: Track): number {
  return track.measures.reduce(
    (max, measure) => Math.max(max, measure.voices.length),
    0
  );
}

/**
 * All of `track`'s note events, ordinal-voice ties rejoined across measure
 * boundaries. Notes are gathered per "voice channel" — the same ordinal
 * voice-index-across-measures approximation `domain/score/ties.ts` uses
 * internally (see its `voiceChannel` doc comment) — since a measure's voice
 * ids aren't stable across a barline, so a chain can only be tracked by
 * position. Order across channels/within is by `startTick`.
 */
function collectTrackNotes(track: Track): NoteEvent[] {
  const voiceCount = maxVoiceCount(track);
  const notes: NoteEvent[] = [];

  for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex += 1) {
    const channelEvents: MusicalEvent[] = [];
    for (const measure of track.measures) {
      const voice = measure.voices[voiceIndex];
      if (voice) channelEvents.push(...voice.events);
    }
    channelEvents.sort((a, b) => a.startTick - b.startTick);
    notes.push(...joinTiedNotes(channelEvents).filter(isNoteEvent));
  }

  return notes;
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
 * (CC10) set at each track's start. Tied notes are rejoined into single MIDI
 * notes before export (MIDI has no tie concept). Sustain pedal data isn't
 * part of the internal `Score` model, so none is emitted (spec §16's
 * "sustain where represented" — nothing is represented here yet).
 */
export function exportMidi(score: Score, codec: MidiCodec): Uint8Array {
  const file: MidiFile = {
    header: {
      name: score.metadata.title,
      ppq: score.ppq,
      tempos: score.tempoMap.map(t => ({ ticks: t.tick, bpm: t.bpm })),
      timeSignatures: collectTimeSignatureChanges(score),
    },
    tracks: score.tracks.map((track): MidiTrackData => ({
      name: track.name,
      channel:
        track.clef === 'percussion' ? PERCUSSION_CHANNEL : track.midiChannel,
      instrument: { number: track.midiProgram },
      notes: collectTrackNotes(track).map(note => ({
        midi: pitchToMidi(note.pitch),
        ticks: note.startTick,
        durationTicks: Math.max(1, note.durationTicks),
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
