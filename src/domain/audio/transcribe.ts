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
export function transcribe(
  audio: DecodedAudio,
  ppq: number,
  /**
   * Reports how far the analysis has got, 0..1.
   *
   * Effectively the pitch tracker's own progress: segmentation and tempo
   * detection run over a few thousand frames rather than a few million
   * samples, so weighting them into the fraction would be arithmetic in
   * service of a number nobody could see move.
   */
  onProgress?: (fraction: number) => void,
): Transcription {
  const detected = segmentNotes(trackPitch(audio.samples, audio.sampleRate, onProgress));
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

/** One note an analyser heard, in seconds — the shape `AudioTranscriber` returns. */
export type HeardNote = {
  midi: number;
  startSec: number;
  durationSec: number;
  amplitude: number;
};

/**
 * Heard notes → a scored transcription.
 *
 * The musical half of the job, and the reason it is here rather than beside
 * the model: choosing a tempo and rounding onto a tick grid are judgements
 * about music, testable with a list of numbers and no browser. The platform
 * layer owns the part that needs a tensor runtime and hands back seconds.
 *
 * Polyphony arrives for free — notes that overlap in time simply do, and
 * `addTranscribedTrackCommand` already allocates voices for them. That is the
 * whole difference from `transcribe`, whose YIN tracker can only ever report
 * one pitch at a time.
 */
export function transcriptionFromHeardNotes(notes: readonly HeardNote[], ppq: number): Transcription {
  // Tempo from onsets alone, as the monophonic path does — a chord's notes
  // share an onset, so simultaneous notes must not each count as a beat.
  const onsets = [...new Set(notes.map((note) => note.startSec))].sort((a, b) => a - b);
  const bpm = detectTempo(onsets);
  const ticksPerSecond = (bpm / 60) * ppq;

  return {
    bpm,
    notes: notes.map((note) => ({
      midi: note.midi,
      startTick: Math.round(note.startSec * ticksPerSecond),
      // At least one tick: a note rounding to zero length would vanish.
      durationTicks: Math.max(1, Math.round(note.durationSec * ticksPerSecond)),
    })),
  };
}
