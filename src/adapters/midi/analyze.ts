/**
 * Read-only summary of a raw MIDI file, for the import wizard (spec §15):
 * per-track name/channel/program/note-count/duration, tempo events, and
 * time signatures, without importing anything into the score model yet.
 */
import { Midi } from '@tonejs/midi';

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

export type MidiTimeSignatureSummary = { tick: number; numerator: number; denominator: number };

export type MidiSummary = {
  ppq: number;
  durationSeconds: number;
  tracks: MidiTrackSummary[];
  tempoEvents: MidiTempoEventSummary[];
  timeSignatures: MidiTimeSignatureSummary[];
};

function summarizeTrack(track: Midi['tracks'][number], index: number): MidiTrackSummary {
  const noteCount = track.notes.length;
  const averageMidi =
    noteCount > 0 ? track.notes.reduce((sum, note) => sum + note.midi, 0) / noteCount : null;

  return {
    index,
    name: track.name.length > 0 ? track.name : `Track ${index + 1}`,
    channel: track.channel,
    program: track.instrument.number,
    instrumentName: track.instrument.name ?? 'Instrument',
    noteCount,
    durationSeconds: track.duration,
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
export function analyzeMidi(data: ArrayBuffer): MidiSummary {
  const midi = new Midi(data);

  return {
    ppq: midi.header.ppq,
    durationSeconds: midi.duration,
    tracks: midi.tracks.map(summarizeTrack),
    tempoEvents: midi.header.tempos.map((t) => ({ tick: t.ticks, bpm: t.bpm })),
    timeSignatures: midi.header.timeSignatures.map((t) => ({
      tick: t.ticks,
      numerator: t.timeSignature[0],
      denominator: t.timeSignature[1],
    })),
  };
}
