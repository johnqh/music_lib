/**
 * Read-only summary of a raw MIDI file, for the import wizard (spec §15):
 * per-track name/channel/program/note-count/duration, tempo events, and
 * time signatures, without importing anything into the score model yet.
 */
import type {
  MidiCodec,
  MidiFile,
  MidiTrackData,
} from '@sudobility/music_types';
import { detectGrid, type DetectedGrid } from './grid-detection.js';

export type MidiTrackSummary = {
  index: number;
  name: string;
  channel: number;
  program: number;
  instrumentName: string;
  noteCount: number;
  durationSeconds: number;
  /** True when the track's channel is 9 (GM channel 10), the standard percussion channel. */
  isPercussion: boolean;
  /** Mean MIDI note number of the track's notes, or `null` if it has none — used to default a target clef. */
  averageMidi: number | null;
};

export type MidiTempoEventSummary = { tick: number; bpm: number };

export type MidiTimeSignatureSummary = {
  tick: number;
  numerator: number;
  denominator: number;
};

export type MidiSummary = {
  ppq: number;
  durationSeconds: number;
  tracks: MidiTrackSummary[];
  tempoEvents: MidiTempoEventSummary[];
  timeSignatures: MidiTimeSignatureSummary[];
  /**
   * The grid the file's onsets already sit on, which the wizard opens
   * pre-filled with. Detected rather than assumed so that importing a file
   * written in triplets or swing does not snap it onto a straight grid — see
   * `grid-detection.ts`.
   */
  detectedGrid: DetectedGrid;
};

function summarizeTrack(track: MidiTrackData, index: number): MidiTrackSummary {
  const noteCount = track.notes.length;
  const averageMidi =
    noteCount > 0
      ? track.notes.reduce((sum, note) => sum + note.midi, 0) / noteCount
      : null;

  return {
    index,
    name: track.name.length > 0 ? track.name : `Track ${index + 1}`,
    channel: track.channel,
    program: track.instrument.number,
    instrumentName: track.instrument.name ?? 'Instrument',
    noteCount,
    durationSeconds: track.durationSeconds,
    isPercussion: track.channel === 9,
    averageMidi,
  };
}

/**
 * Parses `data` as a Standard MIDI File and summarizes it for the import
 * wizard's track list/preview. Throws if `data` isn't valid MIDI (parsing
 * errors are a caller concern — the file picker/wizard is expected to
 * surface them, per spec §28).
 */
export function analyzeMidiFile(midi: MidiFile): MidiSummary {
  // Every track counts, percussion included. Excluding the drums was a
  // mistake: the grid chosen here is applied to *all* of them, so leaving a
  // hi-hat laid on thirty-seconds out of the decision let the melody pick a
  // quarter-note grid and then collapsed the whole kit onto the beat. Erring
  // toward a finer grid costs only some tidiness in the notation; erring
  // toward a coarser one destroys the groove.
  //
  // Note ends go in alongside onsets because the chosen grid quantizes
  // durations too — see `detectGrid`. Percussion contributes onsets only: a
  // drum hit's length is an artefact of how it was recorded, not something
  // anyone plays or reads, and those arbitrary note-offs fit no grid at all,
  // so counting them would send every file with drums to the fallback.
  const positions = midi.tracks.flatMap(track =>
    track.notes.flatMap(note =>
      track.channel === 9
        ? [note.ticks]
        : [note.ticks, note.ticks + note.durationTicks]
    )
  );

  return {
    ppq: midi.header.ppq,
    detectedGrid: detectGrid(positions, midi.header.ppq),
    durationSeconds: midi.duration,
    tracks: midi.tracks.map(summarizeTrack),
    tempoEvents: midi.header.tempos.map(t => ({ tick: t.ticks, bpm: t.bpm })),
    timeSignatures: midi.header.timeSignatures.map(t => ({
      tick: t.ticks,
      numerator: t.timeSignature[0],
      denominator: t.timeSignature[1],
    })),
  };
}

/** Decodes `data` and summarizes it. The codec is the only platform-bound part. */
export function analyzeMidi(data: ArrayBuffer, codec: MidiCodec): MidiSummary {
  return analyzeMidiFile(codec.decode(data));
}
