/**
 * The editor's key bindings, as a table rather than as a DOM listener.
 *
 * What a key *means* is a property of the editor, not of the browser: a
 * desktop build should transpose with the same arrows and write notes with the
 * same letters, and the surest way to make two apps agree is to give them one
 * table rather than two listeners to keep in step.
 *
 * So this owns the bindings and the actions, and the host owns the platform:
 * attaching a listener, deciding what counts as a focused text field, and
 * calling `preventDefault` when the answer comes back `true`. The chord it
 * takes is deliberately not a DOM event — `key` uses the same names
 * `KeyboardEvent.key` does because they are the widely-understood ones, but
 * anything that can produce those strings can drive this.
 */
import type { EditorStoreApi } from './editing.js';
import {
  caretToBarEdge,
  caretToScoreEdge,
  deleteSelected,
  insertNoteAtCaret,
  insertRestAtSelection,
  moveSelectionHorizontal,
  selectAll,
  stepCaret,
  toggleArpeggiate,
  toggleFermata,
  toggleGlissando,
  toggleHairpin,
  toggleOttava,
  toggleSlur,
  toggleTie,
  transposeOctave,
  transposeSemitone,
} from './editing.js';
import {
  durationForDigit,
  isPitchLetter,
  pitchForLetter,
} from '../../domain/notation/note-entry.js';
import { withModifier } from '@sudobility/music_types';

/**
 * One keypress, platform-free.
 *
 * `mod` is Cmd on macOS and Ctrl elsewhere, resolved by the host because only
 * it knows which platform it is on — and reserved for the system throughout
 * this table, so a browser or OS shortcut is never mistaken for an edit.
 */
export type EditorKeyChord = {
  key: string;
  shift: boolean;
  alt: boolean;
  mod: boolean;
};

/**
 * What the host lends the table.
 *
 * `togglePlay` because playback is a real-time device rather than a score
 * edit; the clipboard prompts because cutting and pasting can each have two
 * outcomes and the shortcut must offer the same choice the toolbar does.
 * Both optional: a host without dialogs still gets working shortcuts, falling
 * back to the store actions' own defaults.
 */
export type EditorShortcutHost = {
  togglePlay?: () => void;
  requestCut?: () => void;
  requestPaste?: () => void;
};

/** Marks on Shift — the one modifier left, since letters are note entry and digits are note values. */
const SHIFT_MARKS: Record<string, (store: EditorStoreApi) => void> = {
  F: store => toggleFermata(store),
  A: store => toggleArpeggiate(store),
  G: store => toggleGlissando(store),
  O: store => toggleOttava(store, '8va'),
  '<': store => toggleHairpin(store, 'crescendo'),
  '>': store => toggleHairpin(store, 'diminuendo'),
};

/**
 * Perform whatever `chord` is bound to, and say whether anything was.
 *
 * `false` means the key belongs to the host — nothing was edited and nothing
 * should be swallowed. Every `true` is an edit, so the caller should stop the
 * platform's own handling of it.
 *
 * The order below is load-bearing in one place: the Shift marks are resolved
 * *above* note entry, because `Shift+G` arrives as `"G"` and `pitchForLetter`
 * would otherwise happily write it as a note.
 */
export function runEditorShortcut(
  store: EditorStoreApi,
  chord: EditorKeyChord,
  host: EditorShortcutHost = {}
): boolean {
  const state = store.getState();

  if (chord.key === ' ') {
    host.togglePlay?.();
    return true;
  }

  if (chord.key === 'Escape') {
    state.clearSelection();
    return true;
  }

  if (chord.key === 'Delete') {
    deleteSelected(store);
    return true;
  }

  if (chord.mod) {
    const letter = chord.key.toLowerCase();
    if (letter === 'z') {
      if (chord.shift) state.redo();
      else state.undo();
      return true;
    }
    if (letter === 'c') {
      state.copySelection();
      return true;
    }
    if (letter === 'x') {
      // Through the prompt when there is one: cutting has two possible
      // outcomes and the shortcut must offer the same choice the toolbar does.
      if (host.requestCut) host.requestCut();
      else state.cutSelection();
      return true;
    }
    if (letter === 'v') {
      if (host.requestPaste) host.requestPaste();
      else state.paste();
      return true;
    }
    if (letter === 'a') {
      selectAll(store);
      return true;
    }
  }

  /*
    Caret navigation, on Alt.

    Alt rather than a bare arrow: the arrows already move the selection and
    transpose it, and note entry needs the caret moved without disturbing
    either. Stepping by the current note value is the grid the writer is
    already thinking in.
  */
  if (chord.alt && (chord.key === 'ArrowLeft' || chord.key === 'ArrowRight')) {
    stepCaret(store, chord.key === 'ArrowLeft' ? 'prev' : 'next');
    return true;
  }

  if (chord.key === 'Home' || chord.key === 'End') {
    const edge = chord.key === 'Home' ? 'start' : 'end';
    if (chord.mod) caretToScoreEdge(store, edge);
    else caretToBarEdge(store, edge);
    return true;
  }

  if (chord.shift && !chord.mod && !chord.alt) {
    const mark = SHIFT_MARKS[chord.key];
    if (mark) {
      mark(store);
      return true;
    }
  }

  // Everything below is note entry, and none of it takes a modifier — so a
  // shortcut belonging to the host passing through is never mistaken for a note.
  if (chord.mod || chord.alt) return false;

  const digitDuration = durationForDigit(chord.key, state.snapGrid);
  if (digitDuration) {
    state.setSnapGrid(digitDuration);
    return true;
  }

  // Letters write that pitch at the caret, in the octave nearest the note
  // before it, and step the caret past what was written.
  if (isPitchLetter(chord.key)) {
    insertNoteAtCaret(store, pitchForLetter(store, chord.key), {
      advanceCaret: true,
    });
    return true;
  }

  const letter = chord.key.toLowerCase();
  if (letter === 'n') {
    state.setNoteInput(!state.noteInput);
    return true;
  }
  if (chord.key === '.') {
    state.setSnapGrid(withModifier(state.snapGrid, 'dotted'));
    return true;
  }
  if (letter === 'r') {
    insertRestAtSelection(store);
    return true;
  }
  if (letter === 's') {
    toggleSlur(store);
    return true;
  }
  if (letter === 't') {
    toggleTie(store, 'tieStart');
    return true;
  }

  if (chord.key === 'ArrowUp') {
    if (chord.shift) transposeOctave(store, 1);
    else transposeSemitone(store, 1);
    return true;
  }
  if (chord.key === 'ArrowDown') {
    if (chord.shift) transposeOctave(store, -1);
    else transposeSemitone(store, -1);
    return true;
  }
  if (chord.key === 'ArrowLeft') {
    moveSelectionHorizontal(store, 'prev');
    return true;
  }
  if (chord.key === 'ArrowRight') {
    moveSelectionHorizontal(store, 'next');
    return true;
  }

  return false;
}
