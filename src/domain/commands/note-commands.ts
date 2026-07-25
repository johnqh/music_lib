/**
 * Note-editing command factories (spec §7, §14). Each factory returns a
 * `ScoreCommand` built via `transformCommand`, wrapping a pure
 * `(Score) => Score` transform so undo (via Immer patches) is free and
 * structurally guaranteed to be a deep-equal inverse of execute.
 *
 * Every transform here keeps measures valid: `reflowVoice` (see
 * `reflow.ts`) fills gaps with rests and trims overflow after any note is
 * added, removed, resized, or relocated, and `moveNotesCommand` splits a
 * note that crosses a measure boundary into tied segments via Task 3's
 * `splitNoteAcrossMeasures`, per the Task 5 brief.
 */
import { createId } from '../score/ids.js';
import { splitNoteAcrossMeasures } from '../score/ties.js';
import type { Accidental, Articulation, DurationName, NoteEvent, Pitch, Score, Track, UUID } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { ticksFor } from '../time/ticks.js';
import { transposePitch } from '../pitch/transpose.js';
import type { ScoreCommand } from './types.js';
import { transformCommand } from './snapshot.js';
import {
  clearDanglingTies,
  ensureVoiceAtIndex,
  insertNoteIntoTrack,
  removeNotesFromTrack,
  reflowVoice,
  withTracks,
} from './reflow.js';

// ---- shared traversal helpers ------------------------------------------------

/**
 * Applies `updater` to every note event in `score` whose id is in
 * `eventIds`; other events pass through unchanged. Preserves referential
 * equality at every level (voice/measure/track) that has no matching
 * event, so a call that matches nothing is a true no-op (see `withTracks`).
 */
function mapNotes(score: Score, eventIds: readonly UUID[], updater: (note: NoteEvent) => NoteEvent): Score {
  const idSet = new Set(eventIds);
  const tracks = score.tracks.map((track) => {
    const measures = track.measures.map((measure) => {
      const voices = measure.voices.map((voice) => {
        if (!voice.events.some((e) => idSet.has(e.id))) return voice;
        return {
          ...voice,
          events: voice.events.map((event) => (isNoteEvent(event) && idSet.has(event.id) ? updater(event) : event)),
        };
      });
      const measureChanged = voices.some((v, i) => v !== measure.voices[i]);
      return measureChanged ? { ...measure, voices } : measure;
    });
    const trackChanged = measures.some((m, i) => m !== track.measures[i]);
    return trackChanged ? { ...track, measures } : track;
  });
  return withTracks(score, tracks);
}

// ---- addNoteCommand -----------------------------------------------------------

export type AddNoteParams = {
  trackId: UUID;
  measureId: UUID;
  voiceIndex: number;
  pitch: Pitch;
  startTick: number;
  durationTicks: number;
  velocity?: number;
  articulation?: Articulation;
};

function addNote(score: Score, params: AddNoteParams): Score {
  const tracks = score.tracks.map((track) => {
    if (track.id !== params.trackId) return track;
    const measureExists = track.measures.some((m) => m.id === params.measureId);
    if (!measureExists) return track;

    const note: NoteEvent = {
      id: createId(),
      pitch: params.pitch,
      startTick: params.startTick,
      durationTicks: params.durationTicks,
      velocity: params.velocity ?? 80,
      voiceId: '', // renumbered by insertNoteIntoTrack to the destination voice's id
      trackId: track.id,
      ...(params.articulation ? { articulation: params.articulation } : {}),
    };
    return insertNoteIntoTrack(track, note, params.voiceIndex);
  });

  return withTracks(score, tracks);
}

/**
 * Adds a new note into `params.measureId`'s voice at `params.voiceIndex`,
 * backfilling rests around it. If the new note overlaps an existing note
 * in that voice, the overlap is resolved deterministically by
 * `reflowVoice`'s "replace-on-overlap" rule (see `reflow.ts`): the new
 * note wins, trimming or dropping whatever it overlaps.
 *
 * Only inserted into `params.measureId` itself: if `startTick +
 * durationTicks` extends past that measure's end, the note is silently
 * truncated to fit (by `reflowVoice`'s measure-clipping), not split into
 * tied segments the way `moveNotesCommand`/`pasteEventsCommand` split a
 * note that crosses a boundary. This is a deliberate, narrower behavior
 * for `addNoteCommand` specifically (an add always targets one named
 * measure, unlike a move/paste's computed destination) — callers that
 * want boundary-spanning insertion should add the note measure-local and
 * then use `moveNotesCommand`/`resizeNotesCommand` if it needs to extend
 * further, or split it into per-measure `addNoteCommand` calls themselves.
 */
export function addNoteCommand(params: AddNoteParams): ScoreCommand {
  return transformCommand('Add note', (score) => addNote(score, params));
}

// ---- deleteEventsCommand -------------------------------------------------------

function deleteEvents(score: Score, eventIds: readonly UUID[]): Score {
  const idSet = new Set(eventIds);
  // Clear tie flags left dangling on any surviving partner of a deleted
  // note *before* actually removing the notes (clearDanglingTies needs
  // the deleted notes still in place to find their chain partners).
  const detied = clearDanglingTies(score, idSet);
  const tracks = detied.tracks.map((track) => removeNotesFromTrack(track, idSet));
  return withTracks(detied, tracks);
}

/**
 * Deletes the given note events, backfilling rests so every affected
 * measure stays full. If a deleted note was tied to a partner that isn't
 * also being deleted, that partner's now-dangling tie flag is cleared.
 */
export function deleteEventsCommand(eventIds: UUID[]): ScoreCommand {
  return transformCommand('Delete notes', (score) => deleteEvents(score, eventIds));
}

// ---- moveNotesCommand -----------------------------------------------------------

export type MoveNotesParams = { deltaTicks: number; deltaSemitones: number };

function moveNotesOnTrack(track: Track, eventIds: ReadonlySet<UUID>, params: MoveNotesParams): Track {
  type Moving = { note: NoteEvent; voiceIndex: number };
  const toMove: Moving[] = [];
  track.measures.forEach((measure) => {
    measure.voices.forEach((voice, voiceIndex) => {
      voice.events.forEach((event) => {
        if (isNoteEvent(event) && eventIds.has(event.id)) toMove.push({ note: event, voiceIndex });
      });
    });
  });
  if (toMove.length === 0) return track;

  let working = removeNotesFromTrack(track, new Set(toMove.map((m) => m.note.id)));
  const boundaries = working.measures.map((m) => m.startTick);
  const lastMeasure = working.measures[working.measures.length - 1];
  const trackEnd = lastMeasure ? lastMeasure.startTick + lastMeasure.durationTicks : 0;

  for (const { note, voiceIndex } of toMove) {
    const maxStart = Math.max(0, trackEnd - note.durationTicks);
    const clampedStart = Math.max(0, Math.min(note.startTick + params.deltaTicks, maxStart));
    const destMeasure =
      working.measures.find((m) => clampedStart >= m.startTick && clampedStart < m.startTick + m.durationTicks) ??
      lastMeasure;
    const newPitch =
      params.deltaSemitones !== 0
        ? transposePitch(note.pitch, params.deltaSemitones, destMeasure?.keySignature)
        : note.pitch;

    const movedNote: NoteEvent = {
      ...note,
      startTick: clampedStart,
      pitch: newPitch,
      tieStart: undefined,
      tieStop: undefined,
    };
    const segments = splitNoteAcrossMeasures(movedNote, boundaries);
    for (const segment of segments) {
      working = insertNoteIntoTrack(working, segment, voiceIndex);
    }
  }

  return working;
}

function moveNotes(score: Score, eventIds: readonly UUID[], params: MoveNotesParams): Score {
  const idSet = new Set(eventIds);
  // As in deleteEvents: clear dangling tie flags on any surviving partner
  // of a moved note before moveNotesOnTrack relocates it away.
  const detied = clearDanglingTies(score, idSet);
  const tracks = detied.tracks.map((track) => moveNotesOnTrack(track, idSet, params));
  return withTracks(detied, tracks);
}

/**
 * Moves the given notes by `deltaTicks` (clamped within their track's
 * existing tick span) and transposes them by `deltaSemitones`. A note
 * whose new position crosses a measure boundary is split into tied
 * segments (Task 3's `splitNoteAcrossMeasures`); any pre-existing tie
 * flags on the moved note are cleared first, since its former tie
 * partner(s) are no longer necessarily adjacent after the move. If a
 * moved note was tied to a partner that isn't also being moved, that
 * partner's now-dangling tie flag is cleared too.
 */
export function moveNotesCommand(eventIds: UUID[], params: MoveNotesParams): ScoreCommand {
  return transformCommand('Move notes', (score) => moveNotes(score, eventIds, params));
}

// ---- resizeNotesCommand / changeDurationCommand ----------------------------------

function resizeNotes(score: Score, eventIds: readonly UUID[], durationTicks: number): Score {
  const idSet = new Set(eventIds);
  const tracks = score.tracks.map((track) => {
    const measures = track.measures.map((measure) => {
      let nextMeasure = measure;
      let changed = false;
      for (const voice of measure.voices) {
        if (!voice.events.some((e) => idSet.has(e.id))) continue;
        changed = true;
        const measureEnd = measure.startTick + measure.durationTicks;
        const updatedNotes = voice.events.filter(isNoteEvent).map((e) => {
          if (!idSet.has(e.id)) return e;
          const clamped = Math.max(1, Math.min(durationTicks, measureEnd - e.startTick));
          return { ...e, durationTicks: clamped };
        });
        const withResized = {
          ...nextMeasure,
          voices: nextMeasure.voices.map((v) => (v.id === voice.id ? { ...v, events: updatedNotes } : v)),
        };
        nextMeasure = reflowVoice(withResized, voice.id, track.id);
      }
      return changed ? nextMeasure : measure;
    });
    const trackChanged = measures.some((m, i) => m !== track.measures[i]);
    return trackChanged ? { ...track, measures } : track;
  });
  return withTracks(score, tracks);
}

/**
 * Sets the given notes' duration to `durationTicks` (a raw tick length,
 * e.g. from a piano-roll drag-resize), clamped to fit within each note's
 * current measure (no cross-measure re-splitting), then reflows.
 */
export function resizeNotesCommand(eventIds: UUID[], durationTicks: number): ScoreCommand {
  return transformCommand('Resize notes', (score) => resizeNotes(score, eventIds, durationTicks));
}

/** Sets the given notes' duration to a named value (e.g. from the inspector), converted to ticks via the score's ppq. */
export function changeDurationCommand(eventIds: UUID[], duration: DurationName): ScoreCommand {
  return transformCommand('Change duration', (score) => resizeNotes(score, eventIds, ticksFor(duration, score.ppq)));
}

// ---- simple per-note field commands ------------------------------------------

/** Sets the given notes' pitch to an absolute `Pitch`. */
export function changePitchCommand(eventIds: UUID[], pitch: Pitch): ScoreCommand {
  return transformCommand('Change pitch', (score) => mapNotes(score, eventIds, (note) => ({ ...note, pitch })));
}

/** Sets the given notes' velocity (0-127). */
export function changeVelocityCommand(eventIds: UUID[], velocity: number): ScoreCommand {
  return transformCommand('Change velocity', (score) => mapNotes(score, eventIds, (note) => ({ ...note, velocity })));
}

/** Sets (or clears, when `articulation` is `undefined`) the given notes' articulation. */
export function changeArticulationCommand(eventIds: UUID[], articulation: Articulation | undefined): ScoreCommand {
  return transformCommand('Change articulation', (score) =>
    mapNotes(score, eventIds, (note) => {
      if (articulation) return { ...note, articulation };
      const updated: NoteEvent = { ...note };
      delete updated.articulation;
      return updated;
    }),
  );
}

/** Sets the given notes' pitch accidental, keeping their step/octave. */
export function changeAccidentalCommand(eventIds: UUID[], accidental: Accidental): ScoreCommand {
  return transformCommand('Change accidental', (score) =>
    mapNotes(score, eventIds, (note) => ({ ...note, pitch: { ...note.pitch, accidental } })),
  );
}

/** Toggles `tieStart` or `tieStop` on the given notes. */
export function toggleTieCommand(eventIds: UUID[], which: 'tieStart' | 'tieStop'): ScoreCommand {
  return transformCommand('Toggle tie', (score) =>
    mapNotes(score, eventIds, (note) => ({ ...note, [which]: !note[which] })),
  );
}

// ---- changeVoiceCommand -----------------------------------------------------------

function changeVoice(score: Score, eventIds: readonly UUID[], targetVoiceIndex: number): Score {
  const idSet = new Set(eventIds);
  const tracks = score.tracks.map((track) => {
    const measures = track.measures.map((measure) => {
      const matches: NoteEvent[] = [];
      measure.voices.forEach((voice) => {
        voice.events.forEach((e) => {
          if (isNoteEvent(e) && idSet.has(e.id)) matches.push(e);
        });
      });
      if (matches.length === 0) return measure;

      let nextMeasure = measure;
      for (const voice of measure.voices) {
        if (!voice.events.some((e) => idSet.has(e.id))) continue;
        const remaining = voice.events.filter(isNoteEvent).filter((e) => !idSet.has(e.id));
        const withRemoved = {
          ...nextMeasure,
          voices: nextMeasure.voices.map((v) => (v.id === voice.id ? { ...v, events: remaining } : v)),
        };
        nextMeasure = reflowVoice(withRemoved, voice.id, track.id);
      }

      nextMeasure = ensureVoiceAtIndex(nextMeasure, targetVoiceIndex, track.id);
      const targetVoice = nextMeasure.voices[targetVoiceIndex];
      const existingNotes = targetVoice.events.filter(isNoteEvent);
      const movedNotes = matches.map((n) => ({ ...n, voiceId: targetVoice.id }));
      nextMeasure = {
        ...nextMeasure,
        voices: nextMeasure.voices.map((v, i) =>
          i === targetVoiceIndex ? { ...v, events: [...existingNotes, ...movedNotes] } : v,
        ),
      };
      return reflowVoice(nextMeasure, targetVoice.id, track.id);
    });
    const trackChanged = measures.some((m, i) => m !== track.measures[i]);
    return trackChanged ? { ...track, measures } : track;
  });
  return withTracks(score, tracks);
}

/** Moves the given notes to the voice at ordinal position `targetVoiceIndex` within their current measure (created if absent). */
export function changeVoiceCommand(eventIds: UUID[], targetVoiceIndex: number): ScoreCommand {
  return transformCommand('Change voice', (score) => changeVoice(score, eventIds, targetVoiceIndex));
}
