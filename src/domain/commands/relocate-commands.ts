/**
 * Moving notes to another track, another tick, or both.
 *
 * `moveNotesCommand` already relocates notes *within* a track. This is the
 * cross-track case, and it takes the collision rule as a parameter so that a
 * drag is **one** undo step: composing "clear the span" and "put them there"
 * from two dispatches would make undo step back through the middle of a
 * gesture the user experienced as one.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent, Score, Track, UUID } from '@sudobility/music_types';
import { transformCommand } from './snapshot.js';
import type { ScoreCommand } from './types.js';
import { clearDanglingTies, insertNoteIntoTrack, removeNotesFromTrack, withTracks } from './reflow.js';
import { makeRoom } from './ripple-commands.js';

/** What happens to music already at the destination. Mirrors the editor's edit mode. */
export type CollisionMode = 'stack' | 'replace' | 'ripple';

export type RelocateNotesParams = {
  targetTrackId: UUID;
  deltaTicks: number;
  collision: CollisionMode;
};

type Moving = { note: NoteEvent; voiceIndex: number };

/** Every note in `score` carrying one of `ids`, with the voice it sat in. */
function collect(score: Score, ids: ReadonlySet<UUID>): Moving[] {
  const found: Moving[] = [];
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      measure.voices.forEach((voice, voiceIndex) => {
        for (const event of voice.events) {
          if (isNoteEvent(event) && ids.has(event.id)) found.push({ note: event, voiceIndex });
        }
      });
    }
  }
  return found;
}

/** The last tick a note of `durationTicks` can start at and still fit in `track`. */
function lastStart(track: Track, durationTicks: number): number {
  const last = track.measures[track.measures.length - 1];
  const end = last ? last.startTick + last.durationTicks : 0;
  return Math.max(0, end - durationTicks);
}

/** Ids of notes on `track` sounding inside `[from, to)` in any of `voices`. */
function occupantsOf(
  track: Track,
  from: number,
  to: number,
  voices: ReadonlySet<number>,
): UUID[] {
  const ids: UUID[] = [];
  for (const measure of track.measures) {
    measure.voices.forEach((voice, voiceIndex) => {
      // Voice-scoped: clearing the span across *every* voice would delete the
      // other line, which is a bug this codebase has already had once.
      if (!voices.has(voiceIndex)) return;
      for (const event of voice.events) {
        if (!isNoteEvent(event)) continue;
        if (event.startTick < to && event.startTick + event.durationTicks > from) ids.push(event.id);
      }
    });
  }
  return ids;
}

function relocateNotes(score: Score, eventIds: readonly UUID[], params: RelocateNotesParams): Score {
  const ids = new Set(eventIds);
  const moving = collect(score, ids);
  if (moving.length === 0) return score;
  if (!score.tracks.some((t) => t.id === params.targetTrackId)) return score;

  // Partners left behind must not keep a tie to a note that has gone.
  const detied = clearDanglingTies(score, ids);
  let working = withTracks(
    detied,
    detied.tracks.map((track) => removeNotesFromTrack(track, ids)),
  );

  const target = working.tracks.find((t) => t.id === params.targetTrackId)!;
  const placed = moving.map(({ note, voiceIndex }) => ({
    note,
    voiceIndex,
    startTick: Math.max(
      0,
      Math.min(note.startTick + params.deltaTicks, lastStart(target, note.durationTicks)),
    ),
  }));

  const from = Math.min(...placed.map((p) => p.startTick));
  const to = Math.max(...placed.map((p) => p.startTick + p.note.durationTicks));

  if (params.collision === 'replace') {
    const voices = new Set(placed.map((p) => p.voiceIndex));
    const doomed = new Set(occupantsOf(target, from, to, voices));
    if (doomed.size > 0) {
      working = withTracks(
        working,
        working.tracks.map((t) =>
          t.id === params.targetTrackId ? removeNotesFromTrack(t, doomed) : t,
        ),
      );
    }
  } else if (params.collision === 'ripple') {
    working = makeRoom(working, params.targetTrackId, from, to - from);
  }

  for (const { note, voiceIndex, startTick } of placed) {
    working = withTracks(
      working,
      working.tracks.map((t) =>
        t.id === params.targetTrackId
          ? insertNoteIntoTrack(
              t,
              {
                ...note,
                trackId: params.targetTrackId,
                startTick,
                // The note's former neighbours are not necessarily adjacent
                // any more, so its tie flags cannot survive the move.
                tieStart: undefined,
                tieStop: undefined,
              },
              voiceIndex,
            )
          : t,
      ),
    );
  }

  return working;
}

/**
 * Moves `eventIds` onto `params.targetTrackId`, shifted by `params.deltaTicks`.
 *
 * Pitch is untouched: a note dragged from flute to cello sounds identical, and
 * only its player changes. Notes are clamped into the target track rather than
 * dropped when the shift runs past its end.
 */
export function relocateNotesCommand(
  eventIds: UUID[],
  params: RelocateNotesParams,
): ScoreCommand {
  return transformCommand('Move notes', (score) => relocateNotes(score, eventIds, params));
}
