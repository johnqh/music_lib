/**
 * Turning a score into a neutral tracker module.
 *
 * The exact inverse of `trackerToScore`, and it shares that file's grid:
 * `rowsPerBeat` 4 means a row is a sixteenth, so a 4/4 bar is 16 rows and a
 * 64-row pattern is four bars. Writing on the grid the importer reads is what
 * makes a round trip comparable rather than approximate.
 *
 * **Everything lossy is counted, never hidden.** A tracker row grid, a channel
 * count and a three-octave range are all narrower than a score, so an export
 * can lose material — and a file that quietly is not the music is the failure
 * mode this codebase designs against. The counts go in `TrackerFitReport` and
 * the app shows them before writing.
 *
 * Pure: no bytes, no platform, no store. `TrackerCodec.encode` turns the result
 * into a file.
 */
import type {
  Score,
  TrackerCell,
  TrackerModule,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { pitchToMidi } from '@sudobility/music_types';
import { TRACKER_LIMITS, type WritableTrackerFormat } from './limits.js';

const DEFAULT_ROWS_PER_BEAT = 4;
const ROWS_PER_PATTERN = 64;
const DEFAULT_BPM = 125;

/** What a tracker's one-byte tempo field will accept. */
const MIN_TEMPO = 32;
const MAX_TEMPO = 255;
/** Tried in order; the first that puts tempo in range wins. */
const SPEED_CHOICES = [6, 12, 3] as const;

export type TrackerExportOptions = {
  format: WritableTrackerFormat;
  /** Rows per quarter note. 4 gives sixteenths and cannot express triplets. */
  rowsPerBeat?: number;
};

export type TrackerFitReport = {
  /** Notes moved into range. */
  clampedNotes: number;
  /** Voices that did not fit the format's channel count. */
  droppedVoices: number;
  /** Notes shorter than one row, lost to the grid. */
  droppedShortNotes: number;
  /** Notes whose start moved to land on a row. */
  quantisedNotes: number;
};

export type TrackerExportResult = {
  module: TrackerModule;
  report: TrackerFitReport;
};

/** True when nothing was lost — the case that must not cost the user a click. */
export function isCleanFit(report: TrackerFitReport): boolean {
  return (
    report.clampedNotes === 0 &&
    report.droppedVoices === 0 &&
    report.droppedShortNotes === 0 &&
    report.quantisedNotes === 0
  );
}

/**
 * Speed and tempo for a musical BPM.
 *
 * `effectiveBpm(speed, tempo) = 6 * tempo / speed`, so at speed 6 the tempo
 * field *is* the BPM. That only works while the result fits a byte, and a score
 * may hold 20-400 BPM, so a slow score raises the speed and a fast one lowers
 * it. Every score-legal BPM lands in 32-255 under one of the three.
 */
export function speedAndTempoFor(bpm: number): {
  speed: number;
  tempo: number;
} {
  for (const speed of SPEED_CHOICES) {
    const tempo = Math.round((bpm * speed) / 6);
    if (tempo >= MIN_TEMPO && tempo <= MAX_TEMPO) return { speed, tempo };
  }
  // Unreachable for a valid score; clamp rather than emit an illegal byte.
  return {
    speed: 6,
    tempo: Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(bpm))),
  };
}

const emptyCell = (): TrackerCell => ({ instrument: 0, note: null });

/**
 * Move a note into range by whole octaves.
 *
 * Octaves rather than a hard clamp to the boundary: an octave displacement is
 * still the same pitch class, so a bassline pushed up an octave still reads as
 * that bassline where a note pinned to the lowest available semitone does not.
 */
function clampToRange(midi: number, lowest: number, highest: number): number {
  let value = midi;
  while (value < lowest) value += 12;
  while (value > highest) value -= 12;
  // A range narrower than an octave cannot satisfy both; prefer in-bounds.
  return Math.min(highest, Math.max(lowest, value));
}

export function scoreToTracker(
  score: Score,
  options: TrackerExportOptions
): TrackerExportResult {
  const limits = TRACKER_LIMITS[options.format];
  const rowsPerBeat = options.rowsPerBeat ?? DEFAULT_ROWS_PER_BEAT;
  const ticksPerRow = score.ppq / rowsPerBeat;

  const report: TrackerFitReport = {
    clampedNotes: 0,
    droppedVoices: 0,
    droppedShortNotes: 0,
    quantisedNotes: 0,
  };

  // Channel allocation: each track gets as many channels as its widest measure
  // has voices, and they are laid out consecutively so a track's voices stay
  // together. The total is capped by the format, and the overflow is counted.
  let nextChannel = 0;
  const channelOfVoice: Array<Map<number, number>> = [];
  for (const track of score.tracks) {
    const widest = track.measures.reduce(
      (n, m) => Math.max(n, m.voices.length),
      0
    );
    const map = new Map<number, number>();
    for (let v = 0; v < widest; v += 1) {
      if (nextChannel < limits.channels) {
        map.set(v, nextChannel);
        nextChannel += 1;
      } else {
        report.droppedVoices += 1;
      }
    }
    channelOfVoice.push(map);
  }
  const channels = Math.max(1, Math.min(limits.channels, nextChannel));

  // How long the score runs, in rows.
  let lastTick = 0;
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      lastTick = Math.max(lastTick, measure.startTick + measure.durationTicks);
    }
  }
  const totalRows = Math.max(
    ROWS_PER_PATTERN,
    Math.ceil(lastTick / ticksPerRow)
  );
  const patternCount = Math.ceil(totalRows / ROWS_PER_PATTERN);

  const patterns: TrackerCell[][][] = Array.from({ length: patternCount }, () =>
    Array.from({ length: ROWS_PER_PATTERN }, () =>
      Array.from({ length: channels }, emptyCell)
    )
  );
  const cellAt = (row: number, channel: number): TrackerCell | null => {
    const p = Math.floor(row / ROWS_PER_PATTERN);
    if (p >= patterns.length) return null;
    return patterns[p][row % ROWS_PER_PATTERN][channel];
  };

  score.tracks.forEach((track, trackIndex) => {
    const instrument = trackIndex + 1;
    if (instrument > limits.instruments) return;
    const voiceChannels = channelOfVoice[trackIndex];

    for (const measure of track.measures) {
      measure.voices.forEach((voice, voiceIndex) => {
        const channel = voiceChannels.get(voiceIndex);
        if (channel === undefined) return; // counted as a dropped voice already
        for (const event of voice.events) {
          if (!isNoteEvent(event)) continue;

          const startRow = Math.round(event.startTick / ticksPerRow);
          const endRow = Math.round(
            (event.startTick + event.durationTicks) / ticksPerRow
          );
          if (endRow <= startRow) {
            report.droppedShortNotes += 1;
            continue;
          }
          if (event.startTick % ticksPerRow !== 0) report.quantisedNotes += 1;

          const sounding = pitchToMidi(event.pitch);
          const midi = clampToRange(
            sounding,
            limits.lowestMidi,
            limits.highestMidi
          );
          if (midi !== sounding) report.clampedNotes += 1;

          const start = cellAt(startRow, channel);
          if (start) {
            start.note = midi;
            start.instrument = instrument;
          }
          // A release, unless something else already claims that row on this
          // channel — a new note supersedes the release anyway.
          const end = cellAt(endRow, channel);
          if (end && end.note === null) end.note = 'off';
        }
      });
    }
  });

  // Tempo. The first entry sets both knobs in row 0; later ones move whichever
  // the BPM needs, which `tempoChanges` on the import side reads back.
  const tempoMap =
    score.tempoMap.length > 0
      ? score.tempoMap
      : [{ tick: 0, bpm: DEFAULT_BPM }];
  for (const entry of tempoMap) {
    const row = Math.round(entry.tick / ticksPerRow);
    const cell = cellAt(row, 0);
    if (!cell) continue;
    const { speed, tempo } = speedAndTempoFor(entry.bpm);
    cell.speed = speed;
    cell.bpm = tempo;
  }

  return {
    module: {
      format: options.format,
      title: score.metadata.title,
      channels,
      instruments: score.tracks
        .slice(0, limits.instruments)
        .map((track, i) => ({
          index: i + 1,
          name: track.instrumentName || track.name,
        })),
      order: Array.from({ length: patternCount }, (_, i) => i),
      patterns,
    },
    report,
  };
}
