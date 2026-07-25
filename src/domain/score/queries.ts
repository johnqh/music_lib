import type { ScoreRange } from '../selection/types.js';
import type { Measure, MusicalEvent, NoteEvent, Score, Track, UUID } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { pitchToMidi } from '../pitch/pitch.js';

/** Finds a track by id, or `null` if no track has that id. */
export function findTrack(score: Score, trackId: UUID): Track | null {
  return score.tracks.find((track) => track.id === trackId) ?? null;
}

/** Finds a measure by id across all tracks, or `null` if none has that id. */
export function findMeasure(score: Score, measureId: UUID): Measure | null {
  for (const track of score.tracks) {
    const measure = track.measures.find((m) => m.id === measureId);
    if (measure) return measure;
  }
  return null;
}

/** Finds an event (note or rest) by id across all tracks/measures/voices, or `null`. */
export function findEvent(score: Score, eventId: UUID): MusicalEvent | null {
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        const event = voice.events.find((e) => e.id === eventId);
        if (event) return event;
      }
    }
  }
  return null;
}

/** Whether track `trackId` is included by a range's `trackIds` (empty array means "all tracks"). */
function rangeIncludesTrack(range: ScoreRange, trackId: UUID): boolean {
  return range.trackIds.length === 0 || range.trackIds.includes(trackId);
}

/** Whether `[startTick, startTick + durationTicks)` overlaps `[range.startTick, range.endTick)`. */
function overlapsRange(startTick: number, durationTicks: number, range: ScoreRange): boolean {
  return startTick < range.endTick && startTick + durationTicks > range.startTick;
}

/** All note events (rests excluded) on the requested tracks overlapping the tick range. */
export function eventsInRange(score: Score, range: ScoreRange): NoteEvent[] {
  const result: NoteEvent[] = [];
  for (const track of score.tracks) {
    if (!rangeIncludesTrack(range, track.id)) continue;
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (isNoteEvent(event) && overlapsRange(event.startTick, event.durationTicks, range)) {
            result.push(event);
          }
        }
      }
    }
  }
  return result;
}

/** Measures overlapping the tick range, grouped by track. */
export function measuresInRange(
  score: Score,
  range: ScoreRange,
): Array<{ trackId: UUID; measures: Measure[] }> {
  const result: Array<{ trackId: UUID; measures: Measure[] }> = [];
  for (const track of score.tracks) {
    if (!rangeIncludesTrack(range, track.id)) continue;
    const measures = track.measures.filter((m) => overlapsRange(m.startTick, m.durationTicks, range));
    result.push({ trackId: track.id, measures });
  }
  return result;
}

/**
 * Finds a note event on `trackId` whose span covers `tick`
 * (`startTick <= tick < startTick + durationTicks`), optionally also
 * matching a specific MIDI pitch. Returns `null` if none match.
 */
export function noteAt(score: Score, trackId: UUID, tick: number, midi?: number): NoteEvent | null {
  const track = findTrack(score, trackId);
  if (!track) return null;

  for (const measure of track.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (!isNoteEvent(event)) continue;
        if (tick < event.startTick || tick >= event.startTick + event.durationTicks) continue;
        if (midi !== undefined && pitchToMidi(event.pitch) !== midi) continue;
        return event;
      }
    }
  }
  return null;
}

/** The tick at which the score's last measure (across all tracks) ends; 0 if there are none. */
export function scoreEndTick(score: Score): number {
  let end = 0;
  for (const track of score.tracks) {
    const lastMeasure = track.measures[track.measures.length - 1];
    if (lastMeasure) {
      end = Math.max(end, lastMeasure.startTick + lastMeasure.durationTicks);
    }
  }
  return end;
}

/** All note events (rests excluded) across every track/measure/voice. */
export function allNotes(score: Score): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (isNoteEvent(event)) notes.push(event);
        }
      }
    }
  }
  return notes;
}
