/**
 * Selection slice (spec §9, §37.13): the one place `ScoreSelection` lives,
 * shared by the sheet editor, piano roll, inspector, regeneration panel,
 * playback loop controls, and copy/paste/delete/quantize actions. Also
 * owns the clipboard and the copy/cut/paste actions, since "what's
 * selected" and "what's on the clipboard" are tightly coupled (paste needs
 * to know where the current selection implies content should land).
 */
import type { StateCreator } from 'zustand';
import { allNotes, findEvent } from '../../domain/score/queries.js';
import { selectionToRange } from '../../domain/selection/selection.js';
import { emptySelection } from '../../domain/selection/types.js';
import type { ScoreSelection } from '../../domain/selection/types.js';
import type { NoteEvent, Score, UUID } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { pasteEventsCommand } from '../../domain/commands/edit-commands.js';
import { deleteEventsCommand } from '../../domain/commands/note-commands.js';
import { closeGap, makeRoom } from '../../domain/commands/ripple-commands.js';
import { transformCommand } from '../../domain/commands/snapshot.js';
import type { AppState } from '../useAppStore.js';

export type ClipboardData = { events: NoteEvent[]; anchorTick: number };

export type SelectionSlice = {
  selection: ScoreSelection;
  /**
   * True when the current selection is the direct product of an accepted
   * regeneration — those notes draw in `theme.noteRegenerated` (brown)
   * instead of the normal selected color.
   *
   * Cleared by `setSelection`, and therefore by every selection action
   * (`toggleEvent`/`selectMeasures`/`selectTrack`/`clearSelection` all funnel
   * through it), which is what makes "brown until the selection changes"
   * hold without any other code knowing about the flag. Set only by
   * `generation-slice.acceptCandidate`.
   */
  /**
   * Whether the current selection is material a generation just produced, so
   * the editor can colour it distinctly.
   *
   * Written only by `selectRegenerated`; every ordinary selection change
   * clears it. Its previous writer was the candidate-accept workflow, which
   * generation-as-a-job replaced.
   */
  selectionRegenerated: boolean;
  clipboard: ClipboardData | null;

  setSelection: (selection: ScoreSelection) => void;
  /** Selects notes a generation just wrote, marking them `selectionRegenerated`. */
  selectRegenerated: (eventIds: readonly string[]) => void;
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
  /**
   * Copies the selection, then removes it.
   *
   * `closeGap` slides the rest of the track earlier to fill the hole; without
   * it the notes are simply gone and the time they occupied becomes rests.
   * Which one is wanted is not something the editor can infer, so the caller
   * decides — see the cut dialog.
   */
  cutSelection: (options?: { closeGap?: boolean }) => void;
  /** Pastes the clipboard's notes, anchored at `atTick` (defaults to the tick they were copied from) onto the track implied by the current selection (falling back to the score's first track). No-op if the clipboard is empty or there's no score. */
  /**
   * Pastes the clipboard at `atTick`.
   *
   * `scope` decides what happens to music already there: `replace` clears the
   * span first, `insert` pushes it later. Omitted, it follows `editMode` — so
   * a caller that has already asked the user can pass their answer, and one
   * that has not still behaves consistently with note entry.
   */
  paste: (
    atTick?: number,
    options?: { scope?: 'replace' | 'insert' | 'stack' }
  ) => void;
};

/** The track a paste should target: the current selection's own track scope if it has one, else the track of a selected event, else the score's first track. */
function resolvePasteTrackId(
  score: Score,
  selection: ScoreSelection
): UUID | null {
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
  selectionRegenerated: false,
  clipboard: null,

  /** Selects notes a generation just wrote, and marks them as such. */
  selectRegenerated: eventIds => {
    set(state => {
      state.selection = {
        eventIds: [...eventIds],
        measureIds: [],
        trackIds: [],
      };
      state.selectionRegenerated = eventIds.length > 0;
    });
  },

  setSelection: selection => {
    set(state => {
      state.selection = selection;
      state.selectionRegenerated = false;
    });
    // Routed through generation-slice's own action (rather than this slice
    // writing `state.mode` itself) so generation-slice stays the only code
    // that ever touches its own field.
    get().syncModeFromSelection(selection);
  },

  toggleEvent: eventId => {
    const current = get().selection;
    const eventIds = current.eventIds.includes(eventId)
      ? current.eventIds.filter(id => id !== eventId)
      : [...current.eventIds, eventId];
    get().setSelection({ ...current, eventIds });
  },

  selectMeasures: measureIds => {
    get().setSelection({ eventIds: [], measureIds, trackIds: [] });
  },

  selectTrack: trackId => {
    get().setSelection({ eventIds: [], measureIds: [], trackIds: [trackId] });
  },

  clearSelection: () => {
    get().setSelection(emptySelection());
  },

  copySelection: () => {
    const { score, selection } = get();
    if (!score) return;
    const events = selection.eventIds
      .map(id => findEvent(score, id))
      .filter(
        (event): event is NoteEvent => event !== null && isNoteEvent(event)
      );
    if (events.length === 0) return;
    const anchorTick = Math.min(...events.map(e => e.startTick));
    set(state => {
      state.clipboard = { events, anchorTick };
    });
  },

  cutSelection: options => {
    const { score, selection } = get();
    if (!score) return;

    const cutNotes = selection.eventIds
      .map(id => findEvent(score, id))
      .filter(
        (event): event is NoteEvent => event !== null && isNoteEvent(event)
      );
    if (cutNotes.length === 0) return;

    const noteIds = cutNotes.map(note => note.id);

    // Measured before the delete, while the notes are still there to measure.
    const trackId = cutNotes[0].trackId;
    const sameTrack = cutNotes.every(note => note.trackId === trackId);
    const fromTick = Math.min(...cutNotes.map(note => note.startTick));
    const toTick = Math.max(
      ...cutNotes.map(note => note.startTick + note.durationTicks)
    );

    get().copySelection();
    get().dispatchCommand(deleteEventsCommand(noteIds, 'Delete notes'));

    // Only for a single-track cut: sliding one track earlier while the others
    // stay put is exactly the desynchronisation `insert` mode exists for, and
    // doing it to several tracks at once by accident would be worse.
    if (options?.closeGap && sameTrack) {
      get().dispatchCommand(
        transformCommand('Close gap', current =>
          closeGap(current, trackId, fromTick, toTick - fromTick)
        )
      );
    }

    get().clearSelection();
  },

  paste: (atTick, options) => {
    const { score, clipboard, selection, editMode } = get();
    if (!score || !clipboard || clipboard.events.length === 0) return;
    const trackId = resolvePasteTrackId(score, selection);
    if (!trackId) return;
    const anchorTick = atTick ?? clipboard.anchorTick;

    // How much time the clipboard occupies, measured from its own earliest
    // start — the same span the paste will cover once anchored.
    const clipStart = Math.min(...clipboard.events.map(e => e.startTick));
    const clipEnd = Math.max(
      ...clipboard.events.map(e => e.startTick + e.durationTicks)
    );
    const span = clipEnd - clipStart;

    // Paste obeys the edit mode for the same reason entry does: pasting on top
    // of existing music is the same question as playing on top of it, and
    // answering it differently in the two places would be arbitrary.
    const scope = options?.scope ?? editMode;
    if (scope === 'insert') {
      get().dispatchCommand(
        transformCommand('Make room for paste', current =>
          makeRoom(current, trackId, anchorTick, span)
        )
      );
    } else if (scope === 'replace') {
      // Cleared explicitly, because reflow clusters same-span notes into a
      // chord rather than replacing them — so leaving it implicit would make
      // replace behave as stack whenever the lengths happened to match.
      const occupying = allNotes(get().score ?? score)
        .filter(
          note =>
            note.trackId === trackId &&
            note.startTick < anchorTick + span &&
            note.startTick + note.durationTicks > anchorTick
        )
        .map(note => note.id);
      if (occupying.length > 0)
        get().dispatchCommand(deleteEventsCommand(occupying, 'Delete notes'));
    }

    get().dispatchCommand(
      pasteEventsCommand(
        clipboard.events,
        {
          trackId,
          voiceIndex: 0,
          anchorTick,
        },
        'Paste notes'
      )
    );
  },
});
