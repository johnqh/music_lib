/**
 * Turning a parsed module into a score.
 *
 * Sits beside the MIDI importer, and for the same reason: the codec hands over
 * raw data, and the mapping to the score model happens here where it is
 * testable without the platform layer.
 *
 * Two decisions shape everything below:
 *
 * - **Notes group by sample, not by channel**, so all the bass lands on one
 *   track wherever it was played from. The consequence is that a track is not
 *   always a single line — two channels on one sample at the same row produce
 *   simultaneous notes, which go into separate **voices**.
 * - **The order list is flattened.** A pattern played three times becomes
 *   three sets of measures; a score has no "repeat this pattern", and
 *   inventing one would trade an editable score for a faithful one.
 */
import { createEmptyScore } from '@sudobility/music_types';
import { createId } from '@sudobility/music_types';
import { midiToPitch } from '@sudobility/music_types';
import { effectiveBpm, tempoChanges } from './timing.js';
import { fillVoiceWithRests } from './fill.js';
import type { TrackerCell, TrackerModule } from './types.js';
import type {
  NoteEvent,
  Score,
  TempoEvent,
  Voice,
} from '@sudobility/music_types';

/** A tracker row is a sixteenth: four to the beat. */
const ROWS_PER_BEAT = 4;
const BEATS_PER_MEASURE = 4;

type Placed = {
  instrument: number;
  startRow: number;
  endRow: number;
  midi: number;
};

/**
 * Rows in playback order, honouring `patternBreak`.
 *
 * `Dxx` ends a pattern where it appears rather than at row 64. Ignoring it —
 * which this did — imports a module that uses breaks with too many bars, and
 * silently.
 */
export function flattenRows(module: TrackerModule): TrackerCell[][] {
  const flat: TrackerCell[][] = [];
  for (const patternIndex of module.order) {
    const pattern = module.patterns[patternIndex];
    if (!pattern) continue;
    for (const row of pattern) {
      flat.push(row);
      if (row.some(cell => cell.patternBreak)) break;
    }
  }
  return flat;
}

/**
 * Every note in playback order, with the row each ends on.
 *
 * A channel holds one note at a time. It ends when that channel plays another
 * note, or on an explicit note-off — which MOD never sends, so there the first
 * rule is the only one, exactly as it always was.
 */
function placeNotes(module: TrackerModule): Placed[] {
  const flat = flattenRows(module);
  const placed: Placed[] = [];
  const open = new Map<number, Placed>();

  flat.forEach((cells, row) => {
    cells.forEach((cell, channel) => {
      if (cell.note === null) return;

      const previous = open.get(channel);
      if (previous) previous.endRow = row;
      open.delete(channel);

      // A release ends whatever was sounding and starts nothing.
      if (cell.note === 'off') return;

      const note: Placed = {
        instrument: cell.instrument,
        startRow: row,
        endRow: row + 1,
        midi: cell.note,
      };
      open.set(channel, note);
      placed.push(note);
    });
  });

  return placed;
}

/** Tempo events at ticks, from the flattened row sequence. */
function tempoMapOf(module: TrackerModule, ticksPerRow: number): TempoEvent[] {
  // Given the *flattened* sequence, not one pattern: a change in a later
  // pattern would otherwise be invisible.
  return tempoChanges(flattenRows(module)).map(change => ({
    id: createId(),
    tick: change.row * ticksPerRow,
    bpm: change.bpm,
  }));
}

export function trackerToScore(module: TrackerModule): Score {
  const placed = placeNotes(module);

  // One track per instrument actually used, in first-heard order so the result
  // is stable rather than dependent on the instrument bank's layout.
  const usedInstruments: number[] = [];
  for (const note of placed) {
    if (!usedInstruments.includes(note.instrument))
      usedInstruments.push(note.instrument);
  }

  const nameOf = (instrument: number): string => {
    const found = module.instruments.find(s => s.index === instrument);
    return found && found.name.length > 0
      ? found.name
      : `Instrument ${instrument}`;
  };

  // Counted from the flattened rows, so a pattern break shortens the score
  // rather than leaving empty bars at the end.
  const totalRows = Math.max(1, flattenRows(module).length);
  const measures = Math.max(
    1,
    Math.ceil(totalRows / (ROWS_PER_BEAT * BEATS_PER_MEASURE))
  );

  const base = createEmptyScore({
    title: module.title.length > 0 ? module.title : 'Module',
    measures,
    tracks:
      usedInstruments.length > 0
        ? usedInstruments.map(s => ({
            name: nameOf(s),
            instrumentName: nameOf(s),
            clef: 'treble' as const,
          }))
        : [
            {
              name: 'Module',
              instrumentName: 'Module',
              clef: 'treble' as const,
            },
          ],
  });

  const ticksPerRow = base.ppq / ROWS_PER_BEAT;

  const tracks = base.tracks.map((track, trackIndex) => {
    const instrument = usedInstruments[trackIndex];
    const mine = placed.filter(n => n.instrument === instrument);

    const withNotes = track.measures.map(measure => {
      const measureEnd = measure.startTick + measure.durationTicks;
      const here = mine.filter(n => {
        const tick = n.startRow * ticksPerRow;
        return tick >= measure.startTick && tick < measureEnd;
      });
      // An untouched measure already carries a full-measure rest from
      // `createEmptyScore`, so it is already complete.
      if (here.length === 0) return measure;

      // Voice allocation: a note overlapping one already placed in a voice
      // goes to the next. This is what lets a sample-grouped track hold two
      // channels sounding at once.
      const voiceEnds: number[] = [];
      const voiceEvents: NoteEvent[][] = [];

      for (const note of here) {
        const startTick = note.startRow * ticksPerRow;
        const endTick = Math.min(note.endRow * ticksPerRow, measureEnd);
        let voice = voiceEnds.findIndex(end => end <= startTick);
        if (voice === -1) {
          voice = voiceEnds.length;
          voiceEnds.push(0);
          voiceEvents.push([]);
        }
        voiceEnds[voice] = endTick;
        voiceEvents[voice].push({
          id: createId(),
          pitch: midiToPitch(note.midi, measure.keySignature),
          startTick,
          durationTicks: Math.max(1, endTick - startTick),
          velocity: 80,
          voiceId: '',
          trackId: track.id,
        });
      }

      const voices: Voice[] = voiceEvents.map((events, i) => {
        const id = measure.voices[i]?.id ?? createId();
        return {
          id,
          name: `Voice ${i + 1}`,
          // Rests around the notes, or the bar does not add up — see `fill.ts`.
          events: fillVoiceWithRests(
            events,
            measure.startTick,
            measure.durationTicks,
            base.ppq,
            track.id,
            id
          ),
        };
      });

      return { ...measure, voices };
    });

    return { ...track, measures: withNotes };
  });

  return { ...base, tracks, tempoMap: tempoMapOf(module, ticksPerRow) };
}

export { effectiveBpm, tempoChanges };
