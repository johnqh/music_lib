/**
 * MIDI import wizard options (spec §15): what to include, how to clean up
 * performance timing, and how to lay tracks out on staves. `MidiImportOptions`
 * is the exact shape the Task 7 brief specifies; `defaultMidiImportOptions`
 * derives sensible starting values from an `analyzeMidi` summary so the
 * wizard can open pre-filled.
 */
import type { MidiSummary, MidiTrackSummary } from './analyze';
import type { Clef, DurationName } from '@sudobility/music_types';
import { ticksFor } from '../../domain/time/ticks';

export type MidiTrackSelection = {
  sourceIndex: number;
  include: boolean;
  clef: Clef;
  name: string;
};

export type MidiImportOptions = {
  trackSelections: MidiTrackSelection[];
  /** Quantization grid value (spec §15's "whole" .. "sixteenth triplet" list); `null` skips start/duration quantization entirely. */
  quantizeGrid: DurationName | null;
  /** Use a triplet subdivision of `quantizeGrid` when quantizing. */
  tripletDetection: boolean;
  /** Notes shorter than this (at 480 ppq) are dropped as accidental/ornamental noise. */
  minDurationTicks: number;
  /** Cluster near-simultaneous onsets within a small tolerance onto a shared start tick. */
  mergeNearDuplicates: boolean;
  /** `"extend"` lengthens notes to the sustain-pedal release point; `"ignore"` uses raw note-off timing. */
  sustainPedal: 'extend' | 'ignore';
  /** Split a single MIDI track into two linked grand-staff tracks ("Piano RH"/"Piano LH") instead of one track on `defaultClefFor`'s guessed clef. */
  pianoStaffSplit: boolean;
  /** MIDI note number at/above which a note is placed on the upper (RH/treble) staff when `pianoStaffSplit` is set. */
  splitPointMidi: number;
  /** Estimate a key signature from the included tracks' notes (Krumhansl-style) instead of defaulting to C major. */
  detectKey: boolean;
};

/** The score model's fixed internal PPQ (spec §4/§15: all imports are normalized to 480). */
const SCORE_PPQ = 480;
/** Middle C — the conventional grand-staff RH/LH split point. */
const DEFAULT_SPLIT_POINT_MIDI = 60;

/** Percussion tracks default to the percussion clef; otherwise treble/bass by note centroid (>= middle C -> treble), defaulting to treble for a note-free track. */
function defaultClefFor(track: MidiTrackSummary): Clef {
  if (track.isPercussion) return 'percussion';
  if (track.averageMidi === null) return 'treble';
  return track.averageMidi >= DEFAULT_SPLIT_POINT_MIDI ? 'treble' : 'bass';
}

/**
 * `MidiImportOptions` with defaults pre-filled from `summary`: every
 * non-empty track included, clef guessed per `defaultClefFor`, quantized to
 * the nearest sixteenth note, notes shorter than half a thirty-second note
 * (at 480 ppq) dropped, sustain pedal extension honored, no near-duplicate
 * merging or piano staff split, and key detection on.
 */
export function defaultMidiImportOptions(summary: MidiSummary): MidiImportOptions {
  return {
    trackSelections: summary.tracks.map((track) => ({
      sourceIndex: track.index,
      include: track.noteCount > 0,
      clef: defaultClefFor(track),
      name: track.name,
    })),
    quantizeGrid: 'sixteenth',
    tripletDetection: false,
    minDurationTicks: Math.round(ticksFor('thirtysecond', SCORE_PPQ) / 2),
    mergeNearDuplicates: false,
    sustainPedal: 'extend',
    pianoStaffSplit: false,
    splitPointMidi: DEFAULT_SPLIT_POINT_MIDI,
    detectKey: true,
  };
}
