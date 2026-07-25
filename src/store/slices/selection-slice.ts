/**
 * Selection slice (spec §9, §37.13): the one place `ScoreSelection` lives,
 * shared by the sheet editor, piano roll, inspector, regeneration panel,
 * playback loop controls, and copy/paste/delete/quantize actions. Also
 * owns the clipboard and the copy/cut/paste actions, since "what's
 * selected" and "what's on the clipboard" are tightly coupled (paste needs
 * to know where the current selection implies content should land).
 */
import type { StateCreator } from 'zustand';
import { findEvent } from '../../domain/score/queries.js';
import { selectionToRange } from '../../domain/selection/selection.js';
import { emptySelection } from '../../domain/selection/types.js';
import type { ScoreSelection } from '../../domain/selection/types.js';
import type { NoteEvent, Score, UUID } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { pasteEventsCommand } from '../../domain/commands/edit-commands.js';
import { deleteEventsCommand } from '../../domain/commands/note-commands.js';
import type { AppState } from '../useAppStore.js';

export type ClipboardData = { events: NoteEvent[]; anchorTick: number };

export type SelectionSlice = {
  selection: ScoreSelection;
  clipboard: ClipboardData | null;

  setSelection: (selection: ScoreSelection) => void;
  /** Adds `eventId` to the selection if absent, removes it if present; leaves `measureIds`/`trackIds`/`range` untouched. */
  toggleEvent: (eventId: UUID) => void;
  /** Replaces the selection with a fresh measure-based selection (e.g. clicking a measure header, or the acceptance-criteria "select measures 3 and 4" for regeneration). */
  selectMeasures: (measureIds: UUID[]) => void;
  /** Replaces the selection with a fresh track-scoped selection (e.g. clicking a track header). */
  selectTrack: (trackId: UUID) => void;
  clearSelection: () => void;

  /** Copies the currently-selected note events to the clipboard (no-op if nothing selected resolves to a note). */
  copySelection: () => void;
  /** Copies, then deletes, the currently-selected notes as one undoable command. */
  cutSelection: () => void;
  /** Pastes the clipboard's notes, anchored at `atTick` (defaults to the tick they were copied from) onto the track implied by the current selection (falling back to the score's first track). No-op if the clipboard is empty or there's no score. */
  paste: (atTick?: number) => void;
};

/** The track a paste should target: the current selection's own track scope if it has one, else the track of a selected event, else the score's first track. */
function resolvePasteTrackId(score: Score, selection: ScoreSelection): UUID | null {
  if (selection.trackIds.length > 0) return selection.trackIds[0];
  for (const eventId of selection.eventIds) {
    const event = findEvent(score, eventId);
    if (event) return event.trackId;
  }
  const range = selectionToRange(score, selection);
  if (range && range.trackIds.length > 0) return range.trackIds[0];
  return score.tracks[0]?.id ?? null;
}

export const createSelectionSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  SelectionSlice
> = (set, get) => ({
  selection: emptySelection(),
  clipboard: null,

  setSelection: (selection) => {
    set((state) => {
      state.selection = selection;
    });
    // Routed through generation-slice's own action (rather than this slice
    // writing `state.mode` itself) so generation-slice stays the only code
    // that ever touches its own field.
    get().syncModeFromSelection(selection);
  },

  toggleEvent: (eventId) => {
    const current = get().selection;
    const eventIds = current.eventIds.includes(eventId)
      ? current.eventIds.filter((id) => id !== eventId)
      : [...current.eventIds, eventId];
    get().setSelection({ ...current, eventIds });
  },

  selectMeasures: (measureIds) => {
    get().setSelection({ eventIds: [], measureIds, trackIds: [] });
  },

  selectTrack: (trackId) => {
    get().setSelection({ eventIds: [], measureIds: [], trackIds: [trackId] });
  },

  clearSelection: () => {
    get().setSelection(emptySelection());
  },

  copySelection: () => {
    const { score, selection } = get();
    if (!score) return;
    const events = selection.eventIds
      .map((id) => findEvent(score, id))
      .filter((event): event is NoteEvent => event !== null && isNoteEvent(event));
    if (events.length === 0) return;
    const anchorTick = Math.min(...events.map((e) => e.startTick));
    set((state) => {
      state.clipboard = { events, anchorTick };
    });
  },

  cutSelection: () => {
    const { score, selection } = get();
    if (!score) return;

    const noteIds = selection.eventIds.filter((id) => {
      const event = findEvent(score, id);
      return event !== null && isNoteEvent(event);
    });
    if (noteIds.length === 0) return;

    get().copySelection();
    get().dispatchCommand(deleteEventsCommand(noteIds));
    get().clearSelection();
  },

  paste: (atTick) => {
    const { score, clipboard, selection } = get();
    if (!score || !clipboard || clipboard.events.length === 0) return;
    const trackId = resolvePasteTrackId(score, selection);
    if (!trackId) return;
    const anchorTick = atTick ?? clipboard.anchorTick;
    get().dispatchCommand(
      pasteEventsCommand(clipboard.events, { trackId, voiceIndex: 0, anchorTick }),
    );
  },
});
