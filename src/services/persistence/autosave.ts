/**
 * Debounced autosave (spec §18: "autosave; manual save"). `createAutosaver`
 * wraps an injected `save` callback (typically `() => saveProject(db,
 * record)`) with debounce/coalescing logic so rapid edits (every keystroke,
 * every dragged note) don't each trigger their own IndexedDB write:
 *
 * - `notifyChange()`: marks the project dirty and (re)starts a
 *   `debounceMs` timer; only the *last* call in a burst actually schedules
 *   a save.
 * - `flush()`: cancels any pending timer and saves immediately if there is
 *   unsaved work (a pending timer, or a change that arrived while a save
 *   was already in flight) — a no-op, resolving immediately, if nothing is
 *   dirty. Used for "manual save" and for flushing before navigating away.
 * - `dispose()`: cancels any pending timer and stops scheduling further
 *   saves; an in-flight save (if any) is left to finish on its own since it
 *   can't safely be aborted mid-write.
 *
 * A change that arrives while a save is already in flight is not saved
 * immediately (it would race the in-flight write) — it's coalesced and
 * triggers a fresh `debounceMs` timer once that save settles.
 */
export type Autosaver = {
  notifyChange(): void;
  flush(): Promise<void>;
  dispose(): void;
};

const DEFAULT_DEBOUNCE_MS = 2000;

export function createAutosaver(
  save: () => Promise<void>,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  let disposed = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Runs `save()` now. Assumes no other save is currently in flight. */
  function startSave(): Promise<void> {
    dirty = false;
    const promise = Promise.resolve()
      .then(save)
      .finally(() => {
        inFlight = null;
        // A change arrived while this save was running: rather than
        // save again immediately (which would just be another burst of
        // back-to-back writes), go through a fresh debounce window.
        if (dirty && !disposed) {
          armTimer();
        }
      });
    inFlight = promise;
    return promise;
  }

  function armTimer(): void {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!inFlight) {
        // Fire-and-forget from a timer callback: attach a no-op rejection
        // handler so a failed autosave doesn't surface as an unhandled
        // promise rejection. `flush()`'s own `await`s of `startSave()`
        // still observe (and propagate) the same failure independently.
        startSave().catch(() => {});
      }
    }, debounceMs);
  }

  function notifyChange(): void {
    if (disposed) return;
    dirty = true;
    if (inFlight) return; // picked up by startSave's `finally` once it settles
    armTimer();
  }

  async function flush(): Promise<void> {
    if (disposed) return;
    clearTimer();

    if (inFlight) {
      await inFlight;
      if (!dirty) return;
      // A change arrived during the save above; its `finally` already
      // re-armed a debounce timer for it. Skip the wait and save now.
      clearTimer();
    } else if (!dirty) {
      return;
    }

    await startSave();
  }

  function dispose(): void {
    disposed = true;
    clearTimer();
  }

  return { notifyChange, flush, dispose };
}
