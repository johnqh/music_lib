/**
 * Recording -> notes in ticks.
 *
 * `DecodedAudio` is declared structurally here rather than imported from
 * music_types, so the analysis half of this feature does not wait on a
 * publish cycle. The shapes are identical and assignable either way; when the
 * `AudioCodec` capability lands, this becomes a plain import.
 */
import { trackPitch } from './pitch-track.js';
import { detectTempo, segmentNotes } from './segment.js';

export type DecodedAudio = { samples: Float32Array; sampleRate: number };
export type TranscribedNote = { midi: number; startTick: number; durationTicks: number };
export type Transcription = { bpm: number; notes: TranscribedNote[] };

/**
 * Recording → notes in ticks.
 *
 * Emits **unquantised** ticks against the detected tempo. Quantisation is the
 * caller's step, using the quantiser music_lib already has — this file
 * deliberately does not grow a second implementation of "put it on a grid".
 */
export function transcribe(audio: DecodedAudio, ppq: number): Transcription {
  const detected = segmentNotes(trackPitch(audio.samples, audio.sampleRate));
  const bpm = detectTempo(detected.map((n) => n.startSec));
  const ticksPerSecond = (bpm / 60) * ppq;

  return {
    bpm,
    notes: detected.map((note) => ({
      midi: note.midi,
      startTick: Math.round(note.startSec * ticksPerSecond),
      // At least one tick: a note rounding to zero length would vanish.
      durationTicks: Math.max(1, Math.round((note.endSec - note.startSec) * ticksPerSecond)),
    })),
  };
}
