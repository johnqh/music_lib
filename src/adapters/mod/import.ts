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
import { createEmptyScore } from '../../domain/score/factory.js';
import { createId } from '../../domain/score/ids.js';
import { midiToPitch } from '../../domain/pitch/pitch.js';
import { effectiveBpm, periodToMidi, tempoChanges } from './timing.js';
import type { ModCell, ModFile } from './types.js';
import type { NoteEvent, Score, TempoEvent, Voice } from '@sudobility/music_types';

const ROWS_PER_PATTERN = 64;
/** A tracker row is a sixteenth: four to the beat. */
const ROWS_PER_BEAT = 4;
const BEATS_PER_MEASURE = 4;

type Placed = { sample: number; startRow: number; endRow: number; midi: number };

/** Every note in playback order, with the row each ends on. */
function placeNotes(mod: ModFile): Placed[] {
  const flat: ModCell[][] = [];
  for (const patternIndex of mod.order) {
    const pattern = mod.patterns[patternIndex];
    if (!pattern) continue;
    for (const row of pattern) flat.push(row);
  }

  const placed: Placed[] = [];
  // A channel is monophonic, so a note runs until that channel plays again.
  const open = new Map<number, Placed>();

  flat.forEach((cells, row) => {
    cells.forEach((cell, channel) => {
      const midi = periodToMidi(cell.period);
      if (midi === null) return;

      const previous = open.get(channel);
      if (previous) previous.endRow = row;

      const note: Placed = { sample: cell.sample, startRow: row, endRow: row + 1, midi };
      open.set(channel, note);
      placed.push(note);
    });
  });

  return placed;
}

/** Tempo events at ticks, from the flattened row sequence. */
function tempoMapOf(mod: ModFile, ticksPerRow: number): TempoEvent[] {
  const flat: ModCell[][] = [];
  for (const patternIndex of mod.order) {
    const pattern = mod.patterns[patternIndex];
    if (pattern) for (const row of pattern) flat.push(row);
  }
  // Given the *flattened* sequence, not one pattern: a change in a later
  // pattern would otherwise be invisible.
  return tempoChanges(flat).map((change) => ({
    id: createId(),
    tick: change.row * ticksPerRow,
    bpm: change.bpm,
  }));
}

export function modToScore(mod: ModFile): Score {
  const placed = placeNotes(mod);

  // One track per sample actually used, in first-heard order so the result is
  // stable rather than dependent on the sample bank's layout.
  const usedSamples: number[] = [];
  for (const note of placed) if (!usedSamples.includes(note.sample)) usedSamples.push(note.sample);

  const nameOf = (sample: number): string => {
    const found = mod.samples.find((s) => s.index === sample);
    return found && found.name.length > 0 ? found.name : `Sample ${sample}`;
  };

  const totalRows = Math.max(1, mod.order.length * ROWS_PER_PATTERN);
  const measures = Math.max(1, Math.ceil(totalRows / (ROWS_PER_BEAT * BEATS_PER_MEASURE)));

  const base = createEmptyScore({
    title: mod.title.length > 0 ? mod.title : 'Module',
    measures,
    tracks:
      usedSamples.length > 0
        ? usedSamples.map((s) => ({ name: nameOf(s), instrumentName: nameOf(s), clef: 'treble' as const }))
        : [{ name: 'Module', instrumentName: 'Module', clef: 'treble' as const }],
  });

  const ticksPerRow = base.ppq / ROWS_PER_BEAT;

  const tracks = base.tracks.map((track, trackIndex) => {
    const sample = usedSamples[trackIndex];
    const mine = placed.filter((n) => n.sample === sample);

    const withNotes = track.measures.map((measure) => {
      const measureEnd = measure.startTick + measure.durationTicks;
      const here = mine.filter((n) => {
        const tick = n.startRow * ticksPerRow;
        return tick >= measure.startTick && tick < measureEnd;
      });
      if (here.length === 0) return measure;

      // Voice allocation: a note overlapping one already placed in a voice
      // goes to the next. This is what lets a sample-grouped track hold two
      // channels sounding at once.
      const voiceEnds: number[] = [];
      const voiceEvents: NoteEvent[][] = [];

      for (const note of here) {
        const startTick = note.startRow * ticksPerRow;
        const endTick = Math.min(note.endRow * ticksPerRow, measureEnd);
        let voice = voiceEnds.findIndex((end) => end <= startTick);
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
        return { id, name: `Voice ${i + 1}`, events: events.map((e) => ({ ...e, voiceId: id })) };
      });

      return { ...measure, voices };
    });

    return { ...track, measures: withNotes };
  });

  return { ...base, tracks, tempoMap: tempoMapOf(mod, ticksPerRow) };
}

export { effectiveBpm, periodToMidi, tempoChanges };
