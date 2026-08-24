/**
 * UI-intent -> store-command mapping for the score editor (spec §7's
 * editing-operations list, minus copy/cut/paste/undo/redo, which are
 * already first-class store actions — see `useEditorShortcuts.ts`, which
 * calls those directly and calls into this module for everything else).
 *
 * Every function here takes the store's *bound API* (`EditorStoreApi` —
 * the same shape `createAppStore()`/`useAppStore` return: a React hook
 * that is also a vanilla `getState()`/`subscribe()` object), not a
 * snapshot, and reads fresh state via `store.getState()` on every call —
 * safe to call repeatedly from an event handler without stale-closure
 * risk, and directly unit-testable against a real store instance (no
 * React rendering required).
 *
 * Every mutating function funnels through `dispatchTracked`, which
 * compares `validationIssues` before/after the command and pushes an
 * error toast (spec §7 "prevent edits that create invalid measures...
 * show validation errors clearly") when the edit introduces a *new*
 * validation error that wasn't already present. Existing pre-edit errors
 * are not re-announced on every subsequent unrelated edit.
 */
import { commandLabel, editingCopy } from './copy.js';
import type { createAppStore } from '../../store/useAppStore.js';
import type {
  Accidental,
  Articulation,
  DurationName,
  Hairpin,
  NoteEvent,
  BeamOverride,
  Ottava,
  Ornament,
  Pitch,
  Score,
  UUID,
} from '@sudobility/music_types';
import { createId, isNoteEvent } from '@sudobility/music_types';
import type { MusicalEvent } from '@sudobility/music_types';
import type { ScoreSelection } from '@sudobility/music_types';
import type { ScoreCommand } from '@sudobility/music_types';
import type { ValidationIssue } from '@sudobility/music_types';
import { allNotes, findEvent, findTrack } from '@sudobility/music_types';
import { setLyricCommand, syllabicFor } from '@sudobility/music_types';
import {
  changeBarlineCommand,
  changeMeasureClefCommand,
  changeNavigationCommand,
  changeRepeatsCommand,
  changeTempoCommand,
  setChordSymbolCommand,
  setPickupCommand,
} from '@sudobility/music_types';
import type {
  BarlineStyle,
  Clef,
  Dynamic,
  KeySignature,
  CollisionMode,
  Measure,
  RelocateNotesParams,
  ScoreRange,
  TimeSignature,
} from '@sudobility/music_types';
import {
  changeDynamicCommand,
  changeKeySignatureCommand,
  changePitchCommand,
  changeTimeSignatureCommand,
  changeVoiceCommand,
  clearGraceNotesCommand,
  toGraceNoteCommand,
  importScoreCommand,
  relocateNotesCommand,
  removeTempoCommand,
  shiftDiatonic,
  moveNotesCommand,
  resizeNotesCommand,
  soundingPitchForTrack,
  trackWrittenTransposition,
  transposeKeySignature,
  transposePitch,
} from '@sudobility/music_types';
import {
  chordSelection,
  durationForTap,
  measureAtTick,
  midiToPitch,
  noteIdsInTickRange,
  noteIdsOverlappingRange,
  pitchToMidi,
} from '@sudobility/music_types';
import { selectSelectedNotes } from '../../store/selectors.js';
// Not the playback adapter: editing moves the *position*, and whatever is
// playing follows it. An editor that knew about a player would be an editor a
// second app has to re-teach.
import { getMusicPositionSource } from '@sudobility/music_types';

/**
 * Where the caret is.
 *
 * The position is one number, held outside the store because it changes ~30
 * times a second during playback and Zustand would wake every subscriber at
 * that rate. Editing reads the *reported* tick rather than the smoothed one:
 * an edit lands on a position something vouched for, never on an interpolation
 * between two reports.
 */
function caretTick(): number {
  return getMusicPositionSource().reportedTick;
}
import { selectActiveTrackId } from '../../store/selectors.js';
import { selectVisibleTrackIds } from '../../store/selectors.js';
import {
  clipboardSpan,
  cutNeedsPrompt,
  pasteNeedsPrompt,
  prepareRegenerationRequestForRange,
  replacementRegion,
  scoreWithTracks,
} from '@sudobility/music_types';
import type {
  RegenerateRegionRequest,
  ReplaceScope,
} from '@sudobility/music_types';
import {
  gmMaxPolyphony,
  insertWithRippleCommand,
  trackMaxPolyphony,
} from '@sudobility/music_types';
import type { EditMode } from '../../store/slices/ui-slice.js';
import { ticksFor } from '@sudobility/music_types';
import {
  addNoteCommand,
  addTrackCommand,
  changeAccidentalCommand,
  changeArticulationCommand,
  changeDurationCommand,
  changeVelocityCommand,
  deleteEventsCommand,
  changeOrnamentCommand,
  setFingeringCommand,
  changeBeamCommand,
  toggleArpeggiateCommand,
  toggleGlissandoCommand,
  toggleOttavaCommand,
  toggleFermataCommand,
  toggleHairpinCommand,
  toggleSlurCommand,
  toggleTieCommand,
} from '@sudobility/music_types';
import {
  addMeasureCommand,
  deleteMeasureCommand,
} from '@sudobility/music_types';
import { repairScoreCommand } from '@sudobility/music_types';
import {
  pasteEventsCommand,
  quantizeCommand,
  transposeCommand,
} from '@sudobility/music_types';
import type { QuantizeOptions } from '@sudobility/music_types';

/** The store shape every function in this module operates on: same type `useAppStore`/`createAppStore()` produce. */
export type EditorStoreApi = ReturnType<typeof createAppStore>;

// ---- shared helpers ---------------------------------------------------------

function issueKey(issue: ValidationIssue): string {
  return `${issue.code}:${issue.objectId ?? ''}:${issue.measureId ?? ''}`;
}

/**
 * Runs `command` through the store's `dispatchCommand`, then pushes an
 * error toast if it introduced a validation error that wasn't already
 * present beforehand (identified by code+objectId+measureId). Every
 * mutating action in this module goes through this, not
 * `store.getState().dispatchCommand` directly.
 */
export function dispatchTracked(
  store: EditorStoreApi,
  command: ScoreCommand
): void {
  const before = store.getState().validationIssues;
  store.getState().dispatchCommand(command);
  const after = store.getState().validationIssues;

  const beforeErrorKeys = new Set(
    before.filter(i => i.severity === 'error').map(issueKey)
  );
  const newError = after.find(
    i => i.severity === 'error' && !beforeErrorKeys.has(issueKey(i))
  );
  if (newError) {
    store.getState().pushToast({
      message: editingCopy().validationProblem(newError.message),
      severity: 'error',
    });
  }
}

/** The subset of `selection.eventIds` that currently resolve to `NoteEvent`s in `score` (rests and stale ids are dropped). */
export function selectedNoteIds(
  score: Score,
  selection: ScoreSelection
): UUID[] {
  return selection.eventIds.filter(id => {
    const event = findEvent(score, id);
    return event !== null && isNoteEvent(event);
  });
}

// ---- insert note / rest ------------------------------------------------------

type InsertTarget = {
  trackId: UUID;
  measureId: UUID;
  voiceIndex: number;
  startTick: number;
};

/**
 * Resolves where an insert/rest action should target, from (in priority
 * order): the first selected event's own position; the first selected
 * measure's start; the first selected track's first measure; else the
 * score's very first measure. `null` only if the score has no measures at
 * all on any candidate track.
 */
export function resolveInsertTarget(
  score: Score,
  activeTrackId: UUID | null,
  caretTick: number,
  voiceIndex = 0
): InsertTarget | null {
  // The caret, not the selection. Everywhere else in this editor the caret is
  // the anchor -- a click sets it, playback starts from it -- and inserting
  // from the selection meant that clicking empty staff (which moves the caret
  // and clears the selection) put the next note at the very start of the
  // score, nowhere near where the user was looking.
  const track =
    (activeTrackId ? findTrack(score, activeTrackId) : null) ??
    score.tracks[0] ??
    null;
  if (!track || track.measures.length === 0) return null;

  const tick = Math.max(0, caretTick);
  const measure =
    track.measures.find(
      m => tick >= m.startTick && tick < m.startTick + m.durationTicks
    ) ??
    // Past the end: the last measure, so a caret parked at the final barline
    // still inserts somewhere sensible rather than failing.
    track.measures[track.measures.length - 1];

  return {
    trackId: track.id,
    measureId: measure.id,
    voiceIndex,
    startTick: Math.min(tick, measure.startTick + measure.durationTicks - 1),
  };
}

/**
 * Inserts a note at the current selection's implied measure+beat (see
 * `resolveInsertTarget`), using the store's current `snapGrid` as the
 * note's duration. No-op if there's no score or no resolvable target.
 */
export function insertNoteAtCaret(
  store: EditorStoreApi,
  pitch: Pitch,
  options: {
    articulation?: Articulation;
    duration?: DurationName;
    advanceCaret?: boolean;
  } = {}
): void {
  const state = store.getState();
  if (!state.score) return;
  // Note entry is content, and content is immutable while the transport plays.
  // The store would refuse the command anyway; refusing here keeps the caret
  // and the toolbar's duration state from advancing as though something had
  // been written.
  if (state.state === 'playing') return;
  const target = resolveInsertTarget(
    state.score,
    selectActiveTrackId(state),
    caretTick(),
    state.activeVoiceIndex
  );
  if (!target) return;

  const { articulation, duration, advanceCaret = false } = options;
  // `duration` overrides the toolbar grid, for callers that carry their own --
  // a key tap is written as long as it was held, not as long as the grid says.
  const durationTicks = ticksFor(duration ?? state.snapGrid, state.score.ppq);
  dispatchTracked(
    store,
    addNoteCommand(
      {
        trackId: target.trackId,
        measureId: target.measureId,
        voiceIndex: target.voiceIndex,
        pitch,
        startTick: target.startTick,
        durationTicks,
        ...(articulation ? { articulation } : {}),
      },
      commandLabel('addNote')
    )
  );

  // Step the caret past what was just written, so a run of taps lays out a
  // melody instead of overwriting one position.
  if (advanceCaret)
    getMusicPositionSource().moveTo(target.startTick + durationTicks);
}

/**
 * The pitch the toolbar's Insert Note action should write.
 *
 * It follows the selected note when there is one, because an insert button is
 * usually used to repeat or vary what is already under the cursor. With no
 * selected note it falls back to middle C.
 */
export function defaultInsertPitch(store: EditorStoreApi): Pitch {
  const { score, selection } = store.getState();
  if (score) {
    for (const id of selection.eventIds) {
      const event = findEvent(score, id);
      if (event && isNoteEvent(event)) return event.pitch;
    }
  }
  return { step: 'C', accidental: 0, octave: 4 };
}

/**
 * How many notes already sound at `tick` on `trackId`, counting only those
 * that start there — a chord is notes sharing a start, not notes overlapping.
 */
function chordSizeAt(score: Score, trackId: UUID, tick: number): number {
  const track = findTrack(score, trackId);
  if (!track) return 0;
  let count = 0;
  for (const measure of track.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (isNoteEvent(event) && event.startTick === tick) count += 1;
      }
    }
  }
  return count;
}

/**
 * Writes `pitches` as one chord at the caret: one shared start tick and one
 * shared duration.
 *
 * The shared duration is the whole point, not a simplification. Notes at the
 * same tick cluster by `startTick:durationTicks`, so same-start notes whose
 * durations differ do not stack — the later one wins the span and the earlier
 * is dropped. Writing three keys with three separately-measured tap lengths
 * would therefore silently discard two of them.
 *
 * Refuses chords the instrument could not play (`trackMaxPolyphony`, which is
 * unlimited on a drum track — a kit is not one instrument), counting notes
 * already at the tick so a second pass cannot sneak past the limit.
 * Returns whether anything was written.
 */
export function insertChordAtCaret(
  store: EditorStoreApi,
  pitches: readonly Pitch[],
  options: {
    duration?: DurationName;
    advanceCaret?: boolean;
    /**
     * Overrides the store's `editMode` for this write.
     *
     * Editing an existing chord always stacks, whatever mode the toolbar is
     * in: `replace` would clear the very chord being edited, and `insert`
     * would shove it sideways. The mode describes entering new material, not
     * amending what is already selected.
     */
    mode?: EditMode;
  } = {}
): boolean {
  const state = store.getState();
  if (!state.score || pitches.length === 0) return false;
  // Content is immutable while playing; see `insertNoteAtCaret`. This is also
  // the piano keyboard's write-on-release path, so auditioning still sounds —
  // only the write is suppressed.
  if (state.state === 'playing') return false;
  const target = resolveInsertTarget(
    state.score,
    selectActiveTrackId(state),
    caretTick(),
    state.activeVoiceIndex
  );
  if (!target) return false;

  const track = findTrack(state.score, target.trackId);
  const existing = chordSizeAt(state.score, target.trackId, target.startTick);
  const total = existing + pitches.length;

  // Through the track rather than its program: a percussion track's program is
  // a drum kit, and reading a kit address as an instrument capped a kit at
  // whatever that instrument could play — two notes, for Brush.
  const limit = track ? trackMaxPolyphony(track) : gmMaxPolyphony(0);
  if (total > limit) {
    store.getState().pushToast({
      severity: 'warning',
      message:
        limit === 1
          ? `${track?.instrumentName ?? 'This instrument'} plays one note at a time, so this chord was not added.`
          : `${track?.instrumentName ?? 'This instrument'} plays at most ${limit} notes at once, so this chord was not added.`,
    });
    return false;
  }

  const { duration, advanceCaret = false } = options;
  const durationTicks = ticksFor(duration ?? state.snapGrid, state.score.ppq);

  const mode = options.mode ?? state.editMode;

  // `replace` has to clear the span itself. Leaving it to reflow does not
  // work: notes sharing a start AND a duration cluster into a chord, so a
  // replacement whose length happens to match what is there would silently
  // stack instead — making replace and stack the same mode most of the time.
  if (mode === 'replace') {
    // Scoped to the target voice, not the track. Clearing the span across
    // every voice would delete the other line on the stave, which is the
    // opposite of what a second voice is for.
    const targetMeasure = findTrack(state.score, target.trackId)?.measures.find(
      measure => measure.id === target.measureId
    );
    const targetVoiceId = targetMeasure?.voices[target.voiceIndex]?.id;

    const occupying = allNotes(state.score)
      .filter(
        note =>
          note.trackId === target.trackId &&
          // An absent voice has nothing to clear, and matching every voice
          // would be worse than matching none.
          note.voiceId === targetVoiceId &&
          note.startTick < target.startTick + durationTicks &&
          note.startTick + note.durationTicks > target.startTick
      )
      .map(note => note.id);
    if (occupying.length > 0)
      dispatchTracked(
        store,
        deleteEventsCommand(occupying, commandLabel('deleteEvents'))
      );
  }

  pitches.forEach((pitch, index) => {
    // Only the first note of a chord opens a gap; its siblings land in the gap
    // it made. Rippling per pitch would push the tail three beats for a triad.
    const useRipple = mode === 'insert' && index === 0;
    dispatchTracked(
      store,
      useRipple
        ? insertWithRippleCommand(
            {
              trackId: target.trackId,
              measureId: target.measureId,
              voiceIndex: target.voiceIndex,
              pitch,
              startTick: target.startTick,
              durationTicks,
            },
            commandLabel('insertWithRipple')
          )
        : addNoteCommand(
            {
              trackId: target.trackId,
              measureId: target.measureId,
              voiceIndex: target.voiceIndex,
              pitch,
              startTick: target.startTick,
              durationTicks,
            },
            commandLabel('addNote')
          )
    );
  });

  if (advanceCaret)
    getMusicPositionSource().moveTo(target.startTick + durationTicks);
  return true;
}

/**
 * "Insert rest": in this domain model a silent span is represented
 * implicitly (measures/voices are always fully covered — `reflowVoice`
 * backfills any gap with a `RestEvent`), so replacing the selected note(s)
 * with a rest is exactly deleting them. An alias of `deleteSelected` kept
 * as its own named export because it's a distinct editing *operation* per
 * spec §7's list, even though the implementation coincides.
 */
export function insertRestAtSelection(store: EditorStoreApi): void {
  deleteSelected(store);
}

// ---- transpose ----------------------------------------------------------------

/** Transposes the selected notes by one semitone (`direction` = +1 up / -1 down). No-op if no notes are selected. */
export function transposeSemitone(
  store: EditorStoreApi,
  direction: 1 | -1
): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    transposeCommand(ids, direction, commandLabel('transpose'))
  );
}

/** Transposes the selected notes by one octave (`direction` = +1 up / -1 down). No-op if no notes are selected. */
export function transposeOctave(
  store: EditorStoreApi,
  direction: 1 | -1
): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    transposeCommand(ids, direction * 12, commandLabel('transpose'))
  );
}

// ---- arrow-key selection movement ---------------------------------------------

/**
 * Finds the event immediately before/after `eventId` within the same
 * track and voice-ordinal "channel" (spec §25 convention — voice identity
 * doesn't persist across measures, but position-within-`measure.voices`
 * does), concatenating that channel's events across every measure of the
 * track in tick order. Returns `null` at either end of the channel, or if
 * `eventId` doesn't resolve.
 */
export function findAdjacentEventId(
  score: Score,
  eventId: UUID,
  direction: 'prev' | 'next'
): UUID | null {
  for (const track of score.tracks) {
    for (
      let voiceIndex = 0;
      voiceIndex < (track.measures[0]?.voices.length ?? 0);
      voiceIndex += 1
    ) {
      const channel: MusicalEvent[] = [];
      for (const measure of track.measures) {
        const voice = measure.voices[voiceIndex];
        if (voice) channel.push(...voice.events);
      }
      const index = channel.findIndex(e => e.id === eventId);
      if (index === -1) continue;
      const adjacent =
        direction === 'next' ? channel[index + 1] : channel[index - 1];
      return adjacent?.id ?? null;
    }
  }
  return null;
}

/**
 * Moves the selection to the adjacent event in the same voice (spec §7:
 * "ArrowLeft/ArrowRight: move selection backward/forward"). If nothing is
 * currently selected, seeds the selection with the score's first note
 * (`next`) or last note (`prev`) instead of no-op'ing, so arrow keys work
 * as a first interaction too.
 */
export function moveSelectionHorizontal(
  store: EditorStoreApi,
  direction: 'prev' | 'next'
): void {
  const state = store.getState();
  if (!state.score) return;

  const anchor = state.selection.eventIds[0];
  if (!anchor) {
    const notes = allNotes(state.score);
    if (notes.length === 0) return;
    const seed = direction === 'next' ? notes[0] : notes[notes.length - 1];
    state.setSelection({ eventIds: [seed.id], measureIds: [], trackIds: [] });
    return;
  }

  const adjacentId = findAdjacentEventId(state.score, anchor, direction);
  if (!adjacentId) return;
  state.setSelection({ eventIds: [adjacentId], measureIds: [], trackIds: [] });
}

// ---- caret navigation ----------------------------------------------------------

/**
 * Steps the caret by one note value.
 *
 * The companion to typed note entry: letters write at the caret and step it
 * forward, so going back to fix the note before last has to be possible
 * without the pointer. Moves by the toolbar's current duration, which is the
 * grid the writer is already thinking in.
 *
 * Clamped at zero and at the end of the score — running off either end would
 * put the caret somewhere `resolveInsertTarget` cannot place a note.
 */
export function stepCaret(
  store: EditorStoreApi,
  direction: 'prev' | 'next'
): void {
  const state = store.getState();
  if (!state.score) return;

  const step = ticksFor(state.snapGrid, state.score.ppq);
  const end = scoreDurationTicks(state.score);
  const next = caretTick() + (direction === 'next' ? step : -step);
  getMusicPositionSource().moveTo(
    Math.max(0, Math.min(next, Math.max(0, end - 1)))
  );
}

/** The tick just past the last measure. */
function scoreDurationTicks(score: Score): number {
  let end = 0;
  for (const track of score.tracks) {
    const last = track.measures.at(-1);
    if (last) end = Math.max(end, last.startTick + last.durationTicks);
  }
  return end;
}

/**
 * Moves the caret to a bar edge.
 *
 * `end` lands just inside the bar rather than on the next barline, so
 * "end of bar" is a position a note can still be written at.
 */
export function caretToBarEdge(
  store: EditorStoreApi,
  edge: 'start' | 'end'
): void {
  const state = store.getState();
  if (!state.score) return;

  const measures = state.score.tracks[0]?.measures ?? [];
  const measure = measures.find(
    m =>
      caretTick() >= m.startTick && caretTick() < m.startTick + m.durationTicks
  );
  if (!measure) return;
  getMusicPositionSource().moveTo(
    edge === 'start'
      ? measure.startTick
      : measure.startTick + measure.durationTicks - 1
  );
}

/** Moves the caret to the very start or the very end of the score. */
export function caretToScoreEdge(
  store: EditorStoreApi,
  edge: 'start' | 'end'
): void {
  const state = store.getState();
  if (!state.score) return;
  getMusicPositionSource().moveTo(
    edge === 'start' ? 0 : Math.max(0, scoreDurationTicks(state.score) - 1)
  );
}

/**
 * Moves the caret to the first beat of `bar`, counted from 1.
 *
 * Used by Go to bar, which is how a long score is navigated without scrolling
 * to find the place by eye.
 */
export function caretToBar(store: EditorStoreApi, bar: number): boolean {
  const state = store.getState();
  const measure = state.score?.tracks[0]?.measures[Math.round(bar) - 1];
  if (!measure) return false;
  getMusicPositionSource().moveTo(measure.startTick);
  return true;
}

// ---- delete / duplicate --------------------------------------------------------

/** Deletes the currently selected notes (spec §7 "Delete: delete selected notes") and clears the selection. No-op if no notes are selected. */
export function deleteSelected(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    deleteEventsCommand(ids, commandLabel('deleteEvents'))
  );
  state.clearSelection();
}

/** Appends one empty measure to every track, so the barlines stay aligned. */
export function addMeasure(store: EditorStoreApi): void {
  if (!store.getState().score) return;
  dispatchTracked(store, addMeasureCommand(commandLabel('addMeasure')));
}

/**
 * Removes the measure the caret is in, from every track.
 *
 * Refuses to remove the last one: a score with no measures has nothing to draw
 * and no measure for the caret to sit in, and there would be no control left
 * to undo it with except undo itself.
 */
export function deleteMeasureAtCaret(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;

  const track = state.score.tracks[0];
  if (!track || track.measures.length <= 1) {
    state.pushToast({
      severity: 'warning',
      message: editingCopy().lastMeasureKept,
    });
    return;
  }

  const tick = Math.max(0, caretTick());
  const measure =
    track.measures.find(
      m => tick >= m.startTick && tick < m.startTick + m.durationTicks
    ) ?? track.measures[track.measures.length - 1];

  dispatchTracked(
    store,
    deleteMeasureCommand(measure.index, commandLabel('deleteMeasure'))
  );
}

/**
 * Deletes specific notes by id, leaving the selection alone.
 *
 * Distinct from `deleteSelected`, which clears the selection afterwards: the
 * keyboard removes one note from a selected chord and the rest of that chord
 * must stay selected, or every subsequent key press would fall back to entry
 * mode mid-edit.
 */
export function deleteEvents(store: EditorStoreApi, eventIds: UUID[]): void {
  if (eventIds.length === 0) return;
  dispatchTracked(
    store,
    deleteEventsCommand(eventIds, commandLabel('deleteEvents'))
  );
}

/** Duplicates the currently selected notes immediately after their own latest end tick, on the same track (voice 0 — MVP scope, see brief). No-op if no notes are selected. */
export function duplicateSelected(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  const notes = state.selection.eventIds
    .map(id => findEvent(state.score!, id))
    .filter((e): e is NoteEvent => e !== null && isNoteEvent(e));
  if (notes.length === 0) return;

  const trackId = notes[0].trackId;
  const anchorTick = Math.max(...notes.map(n => n.startTick + n.durationTicks));
  dispatchTracked(
    store,
    pasteEventsCommand(
      notes,
      { trackId, voiceIndex: 0, anchorTick },
      commandLabel('pasteEvents')
    )
  );
}

// ---- select all / measure / track ----------------------------------------------

/** Selects every note event in the score. */
export function selectAll(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  state.setSelection({
    eventIds: allNotes(state.score).map(n => n.id),
    measureIds: [],
    trackIds: [],
  });
}

/** Thin wrapper for symmetry with `selectAll`/`selectTrackAction` — delegates straight to the store action. */
export function selectMeasure(store: EditorStoreApi, measureId: UUID): void {
  store.getState().selectMeasures([measureId]);
}

/** Thin wrapper for symmetry with `selectAll`/`selectMeasure` — delegates straight to the store action. */
export function selectTrackAction(store: EditorStoreApi, trackId: UUID): void {
  store.getState().selectTrack(trackId);
}

// ---- per-note property changes -------------------------------------------------

/** Sets the selected notes' duration. No-op if no notes are selected. */
export function changeDuration(
  store: EditorStoreApi,
  duration: DurationName
): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    changeDurationCommand(ids, duration, commandLabel('changeDuration'))
  );
}

/** Sets the selected notes' velocity (0-127). No-op if no notes are selected. */
export function changeVelocity(store: EditorStoreApi, velocity: number): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    changeVelocityCommand(ids, velocity, commandLabel('changeVelocity'))
  );
}

/** Sets (or clears, with `undefined`) the selected notes' articulation. No-op if no notes are selected. */
export function changeArticulation(
  store: EditorStoreApi,
  articulation: Articulation | undefined
): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    changeArticulationCommand(
      ids,
      articulation,
      commandLabel('changeArticulation')
    )
  );
}

/** Sets (or clears, with `undefined`) the selected notes' ornament sign. No-op if no notes are selected. */
export function changeOrnament(
  store: EditorStoreApi,
  ornament: Ornament | undefined
): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    changeOrnamentCommand(ids, ornament, commandLabel('changeOrnament'))
  );
}

/** Sets the selected notes' accidental. No-op if no notes are selected. */
export function changeAccidental(
  store: EditorStoreApi,
  accidental: Accidental
): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    changeAccidentalCommand(ids, accidental, commandLabel('changeAccidental'))
  );
}

/** Toggles `tieStart`/`tieStop` on the selected notes. No-op if no notes are selected. */
/**
 * Slurs the selection, or removes the slur it already has.
 *
 * Needs two notes or more — a phrase mark over one note means nothing — and
 * the command decides which of them are the endpoints, so a start can never
 * be created without its stop.
 */
export function toggleSlur(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length < 2) return;
  dispatchTracked(store, toggleSlurCommand(ids, commandLabel('toggleSlur')));
}

/**
 * Puts a fermata on the selection, or takes it off.
 *
 * One note is enough, unlike a slur: a fermata belongs to a single note, so
 * there are no endpoints to pick and nothing to refuse.
 */
export function toggleFermata(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    toggleFermataCommand(ids, commandLabel('toggleFermata'))
  );
}

/**
 * Writes a hairpin across the selection, or removes the one it has.
 *
 * Two notes minimum, like a slur and for the same reason: a wedge over one
 * note has nowhere to open to.
 */
export function toggleHairpin(store: EditorStoreApi, hairpin: Hairpin): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length < 2) return;
  dispatchTracked(
    store,
    toggleHairpinCommand(ids, hairpin, commandLabel('toggleHairpin'))
  );
}

/** Rolls the selected chords, or stops rolling them. */
export function toggleArpeggiate(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    toggleArpeggiateCommand(ids, commandLabel('toggleArpeggiate'))
  );
}

/**
 * Sets a beaming override on the selection, or clears it.
 *
 * One note is enough, unlike the slur and the bracket: a break is a property
 * of the note it sits on rather than a span, so "break the beam before this
 * note" is a complete instruction on its own.
 */
export function changeBeam(store: EditorStoreApi, mode: BeamOverride): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    changeBeamCommand(ids, mode, commandLabel('changeBeam'))
  );
}

/** Brackets the selection at an octave, or removes the bracket. Two notes minimum. */
export function toggleOttava(store: EditorStoreApi, ottava: Ottava): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length < 2) return;
  dispatchTracked(
    store,
    toggleOttavaCommand(ids, ottava, commandLabel('toggleOttava'))
  );
}

/** Slides between the selected notes, or removes the slide. Two notes minimum. */
export function toggleGlissando(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length < 2) return;
  dispatchTracked(
    store,
    toggleGlissandoCommand(ids, commandLabel('toggleGlissando'))
  );
}

/** Sets or clears the finger written on the selected notes. */
export function setFingering(
  store: EditorStoreApi,
  fingering: string | undefined
): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    setFingeringCommand(ids, fingering, commandLabel('setFingering'))
  );
}

export function toggleTie(
  store: EditorStoreApi,
  which: 'tieStart' | 'tieStop'
): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    toggleTieCommand(ids, which, commandLabel('toggleTie'))
  );
}

// ---- quantize -------------------------------------------------------------------

/**
 * Quantizes the voice(s) containing the selected notes. No-op if no notes are
 * selected.
 *
 * A selection of >2000 events used to be routed through a `QuantizeService`
 * worker by a `runQuantize` helper, which snapshotted the touched voices with
 * `collectQuantizeTargets` and spliced the result back with
 * `applyQuantizedCommand`. The offload was then measured: `quantizeEvents`
 * takes 0.57ms at that 2000-event threshold, against a ~5ms notation redraw,
 * and `postMessage` structure-clones the whole event array in each direction.
 * The worker was removed rather than retuned — there is no note count at which
 * the clone is cheaper than the work — and with the piano roll's
 * `commitQuantize` gone too, the helper had one caller left and folded into it.
 *
 * Still `async`: `EditorToolbar` and the tests both call it without awaiting,
 * and the body has no `await`, so the command dispatches synchronously within
 * the call either way.
 */
export async function quantizeSelection(
  store: EditorStoreApi,
  options: QuantizeOptions
): Promise<void> {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    quantizeCommand(ids, options, commandLabel('quantize'))
  );
}

/**
 * Repairs every validation issue that has an unambiguous fix, and reports what
 * it managed.
 *
 * Counted from the store's own `validationIssues` before and after rather than
 * from anything the command claims, for the same reason `repairScore` measures
 * itself: the reader is looking at that list, so the number in the toast has
 * to be the number that left it.
 *
 * Goes through `dispatchTracked` like every other edit — so it is undoable in
 * one step, and refused outright while the transport is playing.
 */
export function repairAllIssues(
  store: EditorStoreApi,
  label: string
): { fixed: number; remaining: number } {
  const before = store.getState().validationIssues.length;
  dispatchTracked(store, repairScoreCommand(label));
  const remaining = store.getState().validationIssues.length;
  return { fixed: Math.max(0, before - remaining), remaining };
}

// ---- playing the keyboard ----------------------------------------------------

/**
 * A group of keys was released together: write it, or edit the selected chord.
 *
 * One function because it is one user action. The two jobs are exclusive and
 * choosing between them is a rule about editing, not about a keyboard: with a
 * single chord selected the keys *toggle* its pitches — a lit key removes its
 * note, an unlit one joins the chord — and with nothing selected they enter
 * notes at the caret. Doing both would add a note and also move on.
 *
 * This used to be a loop, a lookup and a branch inside the web keyboard
 * component, which meant a React Native keyboard would have had to reproduce
 * the rule rather than obey it.
 *
 * `heldMs` is how long the whole group was down, first key to last release:
 * one length for the chord, because measuring each key separately gives notes
 * differing by milliseconds, and same-start notes of differing durations
 * delete each other rather than stacking.
 */
export function playKeyGroup(
  store: EditorStoreApi,
  played: { midis: readonly number[]; heldMs: number }
): void {
  const state = store.getState();
  const score = state.score;
  if (!score || played.midis.length === 0) return;

  const chord = chordSelection(selectSelectedNotes(state));
  if (chord) {
    // The chord's own tick, not wherever the caret happens to be, or an added
    // note lands somewhere the player never pointed at.
    getMusicPositionSource().moveTo(chord.startTick);
    for (const midi of played.midis) {
      const existing = chord.notes.find(
        note => pitchToMidi(note.pitch) === midi
      );
      if (existing) deleteEvents(store, [existing.id]);
      else
        insertChordAtCaret(store, [midiToPitch(midi)], {
          advanceCaret: false,
          mode: 'stack',
        });
    }
    return;
  }

  const bpm = score.tempoMap[0]?.bpm ?? 120;
  insertChordAtCaret(
    store,
    // Wrapped, not point-free: `map` would pass the index into `midiToPitch`'s
    // key-signature parameter.
    played.midis.map(midi => midiToPitch(midi)),
    { duration: durationForTap(played.heldMs, bpm), advanceCaret: true }
  );
}

// ---- clicking the sheet ------------------------------------------------------

/**
 * A plain click landed on the sheet: aim the caret there.
 *
 * Three store writes and a position move, as one action — the caret goes where
 * the pointer is, the track under it becomes active, and the selection clears
 * so the caret is the anchor the next range extends from. A caller that did
 * these separately could get two of the three right, which is a bug you only
 * notice as "the caret jumped but the track did not".
 *
 * `trackId` is null where the click was not inside a stave, which leaves the
 * active track alone rather than guessing.
 */
export function placeCaret(
  store: EditorStoreApi,
  at: { tick: number; trackId: UUID | null }
): void {
  const state = store.getState();
  if (!state.score) return;
  if (at.trackId) state.setActiveTrack(at.trackId);
  state.clearSelection();
  getMusicPositionSource().moveTo(Math.max(0, at.tick));
}

/**
 * A click landed on a stave while note input is on: write the note there.
 *
 * The pitch is the *sounding* one; inverting the display lenses is the caller's
 * job, because only the caller knows what was drawn. Everything after that is
 * the same sequence `placeCaret` performs, plus the note — and going through
 * the caret is what gets target resolution, the edit lock and the caret
 * advance for free, exactly as the toolbar and the keyboard do.
 */
export function writeNoteAtPoint(
  store: EditorStoreApi,
  at: { tick: number; trackId: UUID; pitch: Pitch }
): void {
  placeCaret(store, { tick: at.tick, trackId: at.trackId });
  insertNoteAtCaret(store, at.pitch, { advanceCaret: true });
}

/**
 * Select from the caret to a clicked tick, without moving the caret.
 *
 * Not moving it is the point: the same anchor can be extended again and again.
 * The explicit range travels with the selection because regenerating a span of
 * *empty* measures must still work, and a range cannot be derived from an
 * empty list of event ids.
 */
export function selectToTick(
  store: EditorStoreApi,
  to: { tick: number; allTracks: boolean }
): void {
  const state = store.getState();
  const score = state.score;
  if (!score) return;
  const activeTrackId = selectActiveTrackId(state);
  const scopeTrackIds = to.allTracks
    ? score.tracks.map(t => t.id)
    : activeTrackId
      ? [activeTrackId]
      : [];
  const caret = getMusicPositionSource().reportedTick;
  state.setSelection({
    eventIds: noteIdsInTickRange(score, caret, to.tick, scopeTrackIds),
    measureIds: [],
    trackIds: [],
    range: {
      startTick: Math.min(caret, to.tick),
      endTick: Math.max(caret, to.tick),
      trackIds: scopeTrackIds,
    },
  });
}

/**
 * Select a bar, or extend a span to it, and answer the anchor to grow from next.
 *
 * Extending twice from one anchor grows and shrinks the range rather than
 * walking it, which is how every list behaves — so the anchor has to be
 * remembered between clicks rather than derived from the selection, where
 * "3 to 5" and "5 to 3" are indistinguishable afterwards. The caller holds it;
 * the rule for using it is here.
 *
 * `allTracks` is a different question from extending, and keeps its own
 * modifier in the UI: a plain click selects the bar on the *active* track,
 * because that is the part you are reading, while "the same bar everywhere" is
 * something you ask for on purpose.
 */
export function selectMeasureRange(
  store: EditorStoreApi,
  at: {
    index: number;
    anchor: number | null;
    extend: boolean;
    allTracks: boolean;
  }
): number | null {
  const state = store.getState();
  const score = state.score;
  if (!score) return at.anchor;
  const activeTrackId = selectActiveTrackId(state);
  const tracks = at.allTracks
    ? score.tracks
    : score.tracks.filter(t => t.id === activeTrackId);

  const anchorIndex = at.extend ? at.anchor : null;
  const from =
    anchorIndex === null ? at.index : Math.min(anchorIndex, at.index);
  const to = anchorIndex === null ? at.index : Math.max(anchorIndex, at.index);

  const measureIds = tracks.flatMap(t =>
    t.measures.slice(from, to + 1).map(m => m.id)
  );
  if (measureIds.length === 0) return at.anchor;

  state.selectMeasures(measureIds);
  return anchorIndex === null ? at.index : at.anchor;
}

// ---- the toolbar -------------------------------------------------------------

/**
 * Adds a blank track and makes it active.
 *
 * The toolbar only asks for "blank"; creating the id, dispatching the command,
 * and selecting the new track are one editing action a second app should not
 * need to spell out again.
 */
export function addBlankTrack(
  store: EditorStoreApi,
  name = 'New track'
): UUID | null {
  const state = store.getState();
  if (!state.score || state.state === 'playing') return null;

  const id = createId();
  dispatchTracked(
    store,
    addTrackCommand({ id, name }, commandLabel('addTrack'))
  );

  const updated = store.getState().score;
  if (updated && findTrack(updated, id)) {
    store.getState().setActiveTrack(id);
    return id;
  }
  return null;
}

/**
 * A note value was chosen.
 *
 * Two things, because choosing a length means both of them: whatever is
 * selected is retimed, and the next note entered takes that length. A toolbar
 * that did one without the other would be a toolbar whose button means
 * something different depending on whether anything is selected.
 */
export function chooseDuration(
  store: EditorStoreApi,
  duration: DurationName
): void {
  store.getState().setSnapGrid(duration);
  changeDuration(store, duration);
}

/**
 * The edit mode, refused where the active track cannot play a chord.
 *
 * Stacking notes onto a monophonic part cannot work, and a mode chosen before
 * the track changed would otherwise sit there refusing every edit — a refusal
 * that only surfaces after you have already played something. Asked through
 * the *track*, because a drum track's `midiProgram` is a kit: Brush is 40, and
 * so is Violin, which is how the toolbar came to refuse a three-piece drum hit.
 */
export function canStackOnActiveTrack(store: EditorStoreApi): boolean {
  const state = store.getState();
  const activeTrackId = selectActiveTrackId(state);
  const track = state.score?.tracks.find(t => t.id === activeTrackId) ?? null;
  return track === null || trackMaxPolyphony(track) > 1;
}

/**
 * Choose an edit mode, falling back where the active track cannot stack.
 *
 * The fallback lives here rather than in an effect beside the buttons: it is a
 * rule about what an edit mode means, and a second app would otherwise have to
 * remember to reconcile it too.
 */
export function chooseEditMode(store: EditorStoreApi, mode: EditMode): void {
  const allowed = mode !== 'stack' || canStackOnActiveTrack(store);
  store.getState().setEditMode(allowed ? mode : 'replace');
}

// ---- lyrics ------------------------------------------------------------------

/**
 * The syllable currently written on a note, read from the live score.
 *
 * The entry bar walks a snapshot of the notes it was handed, and stepping back
 * over a word just typed showed an empty field until it read the score
 * instead — so this deliberately takes the store's current score rather than
 * anything the caller is holding.
 */
export function lyricTextAt(store: EditorStoreApi, noteId: UUID): string {
  const score = store.getState().score;
  if (!score) return '';
  const event = findEvent(score, noteId);
  return event && isNoteEvent(event) ? (event.lyric?.text ?? '') : '';
}

/**
 * Write a syllable, deriving how it joins to its neighbours.
 *
 * `syllabic` is derived from the keystrokes rather than asked for: a writer
 * knows they are mid-word, and it is what draws the trailing hyphen and fills
 * MusicXML's `<syllabic>`. Empty text clears the lyric rather than storing a
 * blank one.
 *
 * Returns whether this syllable continues a word, which is what the *next*
 * call needs — held by the caller because it is a fact about a run of
 * keystrokes rather than about the score.
 */
export function writeLyric(
  store: EditorStoreApi,
  at: { noteId: UUID; text: string; continuing: boolean; hyphenated: boolean }
): boolean {
  dispatchTracked(
    store,
    setLyricCommand(
      at.noteId,
      at.text.trim() === ''
        ? undefined
        : {
            text: at.text,
            syllabic: syllabicFor(at.continuing, at.hyphenated),
          },
      commandLabel('setLyric')
    )
  );
  return at.hyphenated;
}

// ---- the inspector -----------------------------------------------------------
//
// One function per field. They are thin, and that is the point: a panel that
// dispatched commands itself would be a second place where an edit is named,
// validated and toasted, and a React Native inspector would have to reproduce
// all three. Sentinel values ("inherit", "none") stay in the UI, because they
// are about a select rather than about the score.

/** Marks bar 1 as a pickup of `beats`, or `null` to make it an ordinary bar. */
export function setPickup(store: EditorStoreApi, beats: number | null): void {
  dispatchTracked(store, setPickupCommand(beats, commandLabel('setPickup')));
}

/** `undefined` is the ordinary single line, which is almost every bar. */
export function setBarline(
  store: EditorStoreApi,
  index: number,
  style: BarlineStyle | undefined
): void {
  dispatchTracked(
    store,
    changeBarlineCommand(index, style, commandLabel('changeBarline'))
  );
}

/** `undefined` removes the change, so the clef in force carries on. */
export function setMeasureClef(
  store: EditorStoreApi,
  trackId: UUID,
  index: number,
  clef: Clef | undefined
): void {
  dispatchTracked(
    store,
    changeMeasureClefCommand(
      trackId,
      index,
      clef,
      commandLabel('changeMeasureClef')
    )
  );
}

export function setNavigation(
  store: EditorStoreApi,
  index: number,
  patch: Parameters<typeof changeNavigationCommand>[1]
): void {
  dispatchTracked(
    store,
    changeNavigationCommand(index, patch, commandLabel('changeNavigation'))
  );
}

export function setRepeats(
  store: EditorStoreApi,
  measureId: UUID,
  patch: Parameters<typeof changeRepeatsCommand>[1]
): void {
  dispatchTracked(
    store,
    changeRepeatsCommand(measureId, patch, commandLabel('changeRepeats'))
  );
}

/**
 * Stored as typed, never as a parsed chord.
 *
 * `C-7`, `Cmin7` and `Cm7` are one chord written three ways, and refusing or
 * rewriting any of them would lose what the player meant. Unchanged text is a
 * no-op rather than an undo entry.
 */
export function setChordSymbol(
  store: EditorStoreApi,
  noteId: UUID,
  text: string
): void {
  const score = store.getState().score;
  if (!score) return;
  const event = findEvent(score, noteId);
  if (!event || !isNoteEvent(event)) return;
  if (text.trim() === (event.chordSymbol ?? '')) return;
  dispatchTracked(
    store,
    setChordSymbolCommand(noteId, text, commandLabel('setChordSymbol'))
  );
}

/**
 * A tempo change at a bar, so a piece can slow down or change at a rehearsal
 * point. Refuses a value that is not a tempo, and a value that is already
 * there — neither is worth an undo entry.
 */
export function setTempoAt(
  store: EditorStoreApi,
  at: { tempoEventId?: UUID; tick: number; bpm: number }
): boolean {
  if (!Number.isFinite(at.bpm) || at.bpm <= 0) return false;
  dispatchTracked(
    store,
    changeTempoCommand(
      {
        ...(at.tempoEventId ? { tempoEventId: at.tempoEventId } : {}),
        tick: at.tick,
        bpm: at.bpm,
      },
      commandLabel('changeTempo')
    )
  );
  return true;
}

/** The measure holding a note, found by its track and tick — for its key signature. */
function measureOfNote(score: Score, note: NoteEvent): Measure | null {
  const track = findTrack(score, note.trackId);
  return (
    track?.measures.find(
      m =>
        note.startTick >= m.startTick &&
        note.startTick < m.startTick + m.durationTicks
    ) ?? null
  );
}

/** Retime the selected notes to a plain note value. */
export function resizeNotes(
  store: EditorStoreApi,
  noteIds: readonly UUID[],
  duration: DurationName
): void {
  const score = store.getState().score;
  if (!score || noteIds.length === 0) return;
  dispatchTracked(
    store,
    resizeNotesCommand(
      [...noteIds],
      ticksFor(duration, score.ppq),
      commandLabel('resizeNotes')
    )
  );
}

/** Move one note to a tick, leaving its pitch alone. */
export function moveNoteToTick(
  store: EditorStoreApi,
  noteId: UUID,
  tick: number
): void {
  const score = store.getState().score;
  if (!score) return;
  const event = findEvent(score, noteId);
  if (!event) return;
  const deltaTicks = tick - event.startTick;
  if (deltaTicks === 0) return;
  dispatchTracked(
    store,
    moveNotesCommand(
      [noteId],
      { deltaTicks, deltaSemitones: 0 },
      commandLabel('moveNotes')
    )
  );
}

/**
 * Mark the level a passage begins at, or take the marking off.
 *
 * A dynamic is in force until the next marking, so this is not "set the
 * loudness of these notes" — the note's own velocity survives as a deviation
 * on top, which is what keeps an accent an accent inside a quiet passage.
 */
export function setDynamic(
  store: EditorStoreApi,
  noteIds: readonly UUID[],
  dynamic: Dynamic | undefined
): void {
  if (noteIds.length === 0) return;
  dispatchTracked(
    store,
    changeDynamicCommand([...noteIds], dynamic, commandLabel('changeDynamic'))
  );
}

/**
 * The pitch a note should show in the inspector.
 *
 * This is the forward half of `setNotePitch`: the score stores sounding pitch,
 * while the panel may show what the player reads in written-pitch mode.
 */
export function displayedPitchForNote(
  score: Score,
  note: NoteEvent,
  pitchDisplay: 'concert' | 'written'
): Pitch {
  const track = findTrack(score, note.trackId);
  const semitones =
    pitchDisplay === 'written' && track ? trackWrittenTransposition(track) : 0;
  if (semitones === 0) return note.pitch;

  const key = measureAtTick(score, note.trackId, note.startTick)
    ?.keySignature ?? {
    fifths: 0,
    mode: 'major',
  };
  return transposePitch(
    note.pitch,
    semitones,
    transposeKeySignature(key, semitones)
  );
}

/**
 * Set a note's pitch from the inspector, inverting the written-pitch lens.
 *
 * The panel shows what is *drawn*; the score stores what *sounds*. On a B-flat
 * clarinet read in written pitch those differ by a tone, and storing the drawn
 * value writes a note that draws where it was typed and sounds wrong.
 */
export function setNotePitch(
  store: EditorStoreApi,
  noteId: UUID,
  edited: Pitch,
  pitchDisplay: 'concert' | 'written'
): void {
  const score = store.getState().score;
  if (!score) return;
  const event = findEvent(score, noteId);
  if (!event || !isNoteEvent(event)) return;
  const track = findTrack(score, event.trackId);
  const key = measureOfNote(score, event)?.keySignature ?? {
    fifths: 0,
    mode: 'major',
  };
  const next =
    pitchDisplay === 'written' && track
      ? soundingPitchForTrack(edited, track, key)
      : edited;
  dispatchTracked(
    store,
    changePitchCommand([noteId], next, commandLabel('changePitch'))
  );
}

// ---- dragging on the sheet ---------------------------------------------------

/**
 * Drop dragged notes onto a track and a tick.
 *
 * One command for the whole gesture, so undo restores both the source and the
 * destination in a single step. Pitch is never touched: vertical means *which
 * track*, never *what pitch*.
 */
export function relocateNotes(
  store: EditorStoreApi,
  ids: readonly UUID[],
  target: RelocateNotesParams
): void {
  if (ids.length === 0) return;
  dispatchTracked(
    store,
    relocateNotesCommand([...ids], target, commandLabel('relocateNotes'))
  );
}

/**
 * Commit a pitch drag.
 *
 * The whole gesture is one command, so undo restores the pitch the note had
 * before the drag rather than stepping back through every position it passed.
 * Movement is diatonic, by staff positions rather than semitones, so the note
 * follows the pointer across E-F and B-C.
 */
export function commitPitchDrag(
  store: EditorStoreApi,
  noteId: UUID,
  from: Pitch,
  steps: number
): void {
  if (steps === 0) return;
  dispatchTracked(
    store,
    changePitchCommand(
      [noteId],
      shiftDiatonic(from, steps),
      commandLabel('changePitch')
    )
  );
}

/**
 * The tempo the piece opens at.
 *
 * Always `tempoMap[0]`, never a change part-way: that is `setTempoAt`, and a
 * score with an empty tempo map has no tempo at all, so the opening event is
 * edited rather than removed.
 */
export function setOpeningTempo(store: EditorStoreApi, bpm: number): boolean {
  const score = store.getState().score;
  if (!score || !Number.isFinite(bpm) || bpm <= 0) return false;
  const first = score.tempoMap[0];
  dispatchTracked(
    store,
    changeTempoCommand(
      {
        ...(first ? { tempoEventId: first.id } : {}),
        tick: first?.tick ?? 0,
        bpm,
      },
      commandLabel('changeTempo')
    )
  );
  return true;
}

/** Drop a tempo change, leaving the tempo in force to carry on from earlier. */
export function removeTempoAt(store: EditorStoreApi, tempoEventId: UUID): void {
  dispatchTracked(
    store,
    removeTempoCommand(tempoEventId, commandLabel('changeTempo'))
  );
}

/** Adopt an imported score, as one undoable step. */
export function importScore(store: EditorStoreApi, score: Score): void {
  dispatchTracked(
    store,
    importScoreCommand(score, commandLabel('importScore'))
  );
}

/** Move notes to a voice, counted from 0 — the panel counts from 1. */
export function setVoice(
  store: EditorStoreApi,
  noteIds: readonly UUID[],
  voiceIndex: number
): void {
  if (noteIds.length === 0) return;
  dispatchTracked(
    store,
    changeVoiceCommand(
      [...noteIds],
      Math.max(0, voiceIndex),
      commandLabel('changeVoice')
    )
  );
}

/**
 * Turn a note into an ornament on whatever follows it.
 *
 * It takes no time from the bar, so the note leaves the voice and a rest of the
 * same length stays behind — which is what keeps the measure adding up.
 */
export function toGraceNote(store: EditorStoreApi, noteId: UUID): void {
  dispatchTracked(
    store,
    toGraceNoteCommand(noteId, commandLabel('toGraceNote'))
  );
}

export function clearGraceNotes(
  store: EditorStoreApi,
  noteIds: readonly UUID[]
): void {
  if (noteIds.length === 0) return;
  dispatchTracked(
    store,
    clearGraceNotesCommand([...noteIds], commandLabel('toGraceNote'))
  );
}

/**
 * Apply a time signature to every selected measure.
 *
 * The loop is here rather than at the call site because it is one action to
 * the person doing it: choosing 6/8 for a selection of bars is a single
 * decision, and a caller that looped would be a caller that could get the
 * loop subtly different.
 */
export function setTimeSignature(
  store: EditorStoreApi,
  measureIds: readonly UUID[],
  timeSignature: TimeSignature
): void {
  for (const id of measureIds) {
    dispatchTracked(
      store,
      changeTimeSignatureCommand(
        id,
        timeSignature,
        commandLabel('changeTimeSignature')
      )
    );
  }
}

/** The same, for the key. */
export function setKeySignature(
  store: EditorStoreApi,
  measureIds: readonly UUID[],
  keySignature: KeySignature
): void {
  for (const id of measureIds) {
    dispatchTracked(
      store,
      changeKeySignatureCommand(
        id,
        keySignature,
        commandLabel('changeKeySignature')
      )
    );
  }
}

/**
 * The collision rule a write uses, from the toolbar's edit mode.
 *
 * A drop is a write, so it obeys the mode already set rather than inventing a
 * rule or asking. `insert` ripples, which is what `insert` means everywhere
 * else in the editor — the two names differ only because the collision enum
 * is about what happens to what was already there.
 */
export function collisionForEditMode(mode: EditMode): CollisionMode {
  return mode === 'insert' ? 'ripple' : mode;
}

/**
 * Mark what a generation actually wrote, so it colours as new material.
 *
 * Found by the region that was asked for rather than by watching the edit: a
 * job applies server-side, so there is no command to observe. Overlap rather
 * than containment, because a note that was already sounding into the region
 * was replaced too.
 */
export function selectRegeneratedInRange(
  store: EditorStoreApi,
  range: ScoreRange
): void {
  const score = store.getState().score;
  if (!score) return;
  const written = noteIdsOverlappingRange(score, range);
  if (written.length > 0) store.getState().selectRegenerated(written);
}

// ---- generation and export scope ---------------------------------------------

/** What the Replace dialog collects. The region it applies to is derived, not asked for. */
export type ReplaceSubmission = {
  instruction: string;
  style?: string;
  mood?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
  constraints: {
    preserveBoundaryNotes: boolean;
    preserveHarmony: boolean;
    preserveRhythm: boolean;
    preserveMelody: boolean;
  };
};

/** A replacement ready to submit: which kind of job, the request, and the region it will overwrite. */
export type PreparedReplacement = {
  kind: 'replace-notes' | 'replace-measures' | 'replace-track';
  request: RegenerateRegionRequest;
  range: ScoreRange;
};

/**
 * Turn a Replace submission into the request the server actually needs.
 *
 * The dialog only collects settings; the region — its tick range, the fragment
 * being replaced, and the surrounding context the model reads to continue
 * seamlessly — is derived from the selection and the scope. Sending the
 * settings alone would leave the server guessing at the part of the score
 * nobody described.
 *
 * `null` when the selection yields no region, which is the honest answer for
 * "replace the notes" with nothing selected.
 */
export function prepareReplacement(
  store: EditorStoreApi,
  scope: ReplaceScope,
  submission: ReplaceSubmission
): PreparedReplacement | null {
  const state = store.getState();
  const current = state.score;
  if (!current) return null;

  const region = replacementRegion(
    current,
    state.selection,
    selectActiveTrackId(state),
    scope
  );
  if (!region) return null;

  const request = prepareRegenerationRequestForRange(
    current,
    region.range,
    submission.instruction,
    {
      measureAligned: region.measureAligned,
      ...(submission.style ? { style: submission.style } : {}),
      ...(submission.mood ? { mood: submission.mood } : {}),
      ...(submission.complexity ? { complexity: submission.complexity } : {}),
      constraints: submission.constraints,
    }
  );

  const kind =
    scope === 'notes'
      ? 'replace-notes'
      : scope === 'measures'
        ? 'replace-measures'
        : 'replace-track';

  return { kind, request, range: region.range };
}

/**
 * Whether an export has to ask which tracks it covers.
 *
 * Only when something is hidden: with every track visible the two answers
 * produce the same file, and a dialog whose options do the same thing is a
 * click nobody can get wrong. Same rule the cut and paste prompts follow.
 */
export function exportScopeNeedsPrompt(store: EditorStoreApi): boolean {
  return hiddenTrackCount(store) > 0;
}

/** How many tracks the score has that the editor is not showing. */
export function hiddenTrackCount(store: EditorStoreApi): number {
  const state = store.getState();
  const score = state.score;
  if (!score) return 0;
  return score.tracks.length - selectVisibleTrackIds(state).length;
}

/** The score an export writes, for the scope the user chose. */
export function exportTargetScore(
  store: EditorStoreApi,
  scope: 'all' | 'visible'
): Score | null {
  const state = store.getState();
  const score = state.score;
  if (!score) return null;
  return scope === 'all'
    ? score
    : scoreWithTracks(score, [...selectVisibleTrackIds(state)]);
}

// ---- clipboard ---------------------------------------------------------------

/**
 * Whether cutting the current selection has to ask "leave silence, or close
 * the gap?".
 *
 * The rule for *not* asking lives in `cutNeedsPrompt`; this is the part that
 * knows where the selection is. Both halves are here so the UI's only job is
 * to open a dialog when told to.
 */
export function cutWouldPrompt(store: EditorStoreApi): boolean {
  const state = store.getState();
  const score = state.score;
  if (!score) return false;
  const notes = state.selection.eventIds
    .map(id => findEvent(score, id))
    .filter(
      (event): event is NoteEvent => event !== null && isNoteEvent(event)
    );
  if (notes.length === 0) return false;
  return cutNeedsPrompt(score, notes);
}

/** The same, for pasting: only when the target span already holds something. */
export function pasteWouldPrompt(store: EditorStoreApi): boolean {
  const state = store.getState();
  const score = state.score;
  const clipboard = state.clipboard;
  if (!score || !clipboard || clipboard.events.length === 0) return false;
  const trackId = selectActiveTrackId(state);
  if (!trackId) return false;
  return pasteNeedsPrompt(
    score,
    trackId,
    clipboard.anchorTick,
    clipboardSpan(clipboard.events)
  );
}
