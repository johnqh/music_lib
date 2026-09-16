/**
 * Saving one document: the rules, with the destination left open.
 *
 * This is what the project slice's autosave callback was, with the one part
 * that differed between origins lifted out. A server project and a local file
 * are saved by the same rules — debounced, one write at a time, the score left
 * out when it has not moved, the save state and the dirty flag kept honest, a
 * failure surfaced rather than swallowed — and differ only in where the bytes
 * go. The native app wrote a second autosaver for its files, and it had
 * already drifted: it cleared `dirty` on a write that raced an edit, and knew
 * nothing of the save state a generation poll reads.
 *
 * **Dirty is cleared only when what was saved is still what is open.** A write
 * takes a moment; an edit can land during it. The save wrote the score as it
 * was when it started, so calling the store clean when it returns would mark
 * as saved an edit that never was — a document that looks safe to close. The
 * check is the score's identity (every edit makes a new score) and a revision
 * counted by `notifyChange` (which also covers a change that is not the score,
 * such as hiding a track). Either moving means the store stays `unsaved`, and
 * the autosaver — which saw the same change arrive — saves again.
 */
import type { SaveState, Score } from '@sudobility/music_types';
import type { UiSlice } from '@sudobility/music_editing';
import { createAutosaver } from './autosave.js';
import { libraryMessage } from '../messages.js';

/** The part of a store the saver reads and writes. */
export type PersistedState = {
  score: Score | null;
  dirty: boolean;
  saveState: SaveState;
  serverUpdatedAt: string | null;
  pushToast: UiSlice['pushToast'];
};

/**
 * One write of the document, to wherever it lives.
 *
 * `scoreChanged` is false when this exact score object is the one last
 * written, so a server write can leave the largest thing this app owns out of
 * a save that exists only to persist a hidden-track list. A file has no such
 * choice and ignores it. A server write reports the `updatedAt` it left behind,
 * so a poller can recognise it as this client's own.
 */
export type SaveWrite = (request: {
  score: Score;
  scoreChanged: boolean;
}) => Promise<{ updatedAt?: string } | void>;

export type DocumentSaverOptions<T extends PersistedState> = {
  set: (updater: (draft: T) => void) => void;
  get: () => T;
  /**
   * The write for the document as it stands, or `null` when it has nowhere to
   * go yet.
   *
   * Read at the moment of saving, not captured, because the destination can
   * change under a pending save — a Save As, a Sync to server. `null` is a
   * never-saved document: choosing where it lives is the reader's decision,
   * and picking a path for them is how a file ends up somewhere nobody looks.
   */
  destination: () => SaveWrite | null;
  debounceMs?: number;
};

export type DocumentSaver = {
  /** An edit worth saving happened. Starts (or restarts) the debounce. */
  notifyChange(): void;
  /** Saves now if anything is pending; resolves at once if nothing is. */
  flush(): Promise<void>;
  /** Stops scheduling. An in-flight write is left to finish. */
  dispose(): void;
  /**
   * Records that the destination already holds `score` — after an open, a
   * create or a reload — so the next save can leave it out.
   */
  adopted(score: Score | null): void;
};

export function createDocumentSaver<T extends PersistedState>(
  options: DocumentSaverOptions<T>
): DocumentSaver {
  const { set, get } = options;
  /**
   * The exact score object the destination was last given (or handed us).
   *
   * Identity, not a deep compare: every mutation goes through a command that
   * returns a new score, so an unchanged reference *is* an unchanged score.
   */
  let lastSavedScore: Score | null = null;
  let revision = 0;

  const autosaver = createAutosaver(async () => {
    const write = options.destination();
    const score = get().score;
    if (!write || !score) return;
    const startedAt = revision;
    set(state => {
      state.saveState = 'saving';
    });
    try {
      const result = await write({
        score,
        scoreChanged: score !== lastSavedScore,
      });
      lastSavedScore = score;
      const stillCurrent = get().score === score && revision === startedAt;
      set(state => {
        // Left `unsaved` when an edit arrived mid-write: the autosaver saw it
        // too and has already queued the save that will carry it.
        state.saveState = stillCurrent ? 'saved' : 'unsaved';
        if (stillCurrent) state.dirty = false;
        // Recorded either way — the server is where this write left it — so a
        // status poll can recognise it as ours.
        if (result?.updatedAt) state.serverUpdatedAt = result.updatedAt;
      });
    } catch (err) {
      // Keep the dirty flag so the next change or flush retries.
      set(state => {
        state.saveState = 'unsaved';
      });
      get().pushToast({
        severity: 'error',
        message: libraryMessage('saveFailed'),
      });
      throw err;
    }
  }, options.debounceMs);

  return {
    notifyChange: () => {
      revision += 1;
      autosaver.notifyChange();
    },
    flush: () => autosaver.flush(),
    dispose: () => autosaver.dispose(),
    adopted: score => {
      lastSavedScore = score;
    },
  };
}
