/**
 * Project slice (spec §18, §19): project identity (`projectId`/
 * `projectName`), dirty/save-state tracking, and the actions that create/
 * open/save a project — now against music_api via the injected
 * `StoreContext`'s MusicClient (server-side persistence replaced Dexie in
 * Phase 2). Debounced autosave is retained via `createAutosaver`: every
 * mutation that goes through `score-slice` calls `markDirty()`, which
 * notifies the autosaver; the autosaver's save PUTs the current score (and
 * name) to `/projects/:id`.
 */
import type { StateCreator } from "zustand";
import { createEmptyScore } from "../../domain/score/factory.js";
import type { ProjectRecord, Score } from "@sudobility/music_types";
import { createAutosaver } from "../../services/persistence/autosave.js";
import type { Autosaver } from "../../services/persistence/autosave.js";
import { requireToken, type StoreContext } from "../context.js";
import type { AppState } from "../useAppStore.js";

export type SaveState = "saved" | "saving" | "unsaved";

export type NewProjectInput = { name: string; score?: Score };

export type ProjectSlice = {
  projectId: string | null;
  projectName: string;
  dirty: boolean;
  saveState: SaveState;

  /** Creates and persists a brand-new project on the server, then loads its score (fresh undo history) into `score-slice`. */
  newProject: (input: NewProjectInput) => Promise<void>;
  /** Loads an existing project by id from the server, then loads its score (fresh undo history) into `score-slice`. */
  openProject: (id: string) => Promise<void>;
  /** Flushes any pending autosave immediately (spec §18: "manual save"). No-op if nothing is dirty or no project is open. */
  saveNow: () => Promise<void>;
  /** Marks the current project dirty and notifies the autosaver. Called by `score-slice` after every `dispatchCommand`/`undo`/`redo`; not normally called directly by UI code. */
  markDirty: () => void;
  /** Renames the currently-open project. The new name persists on the next autosave/`saveNow()` flush. No-op if no project is open. */
  renameProject: (name: string) => void;
};

export function createProjectSlice(
  context: StoreContext,
): StateCreator<AppState, [["zustand/immer", never]], [], ProjectSlice> {
  return (set, get) => {
    let currentRecord: ProjectRecord | null = null;
    let autosaver: Autosaver | null = null;

    function attachAutosaver(): Autosaver {
      autosaver?.dispose();
      const next = createAutosaver(async () => {
        const record = currentRecord;
        const score = get().score;
        if (!record || !score) return;
        set((state) => {
          state.saveState = "saving";
        });
        try {
          const token = await requireToken(context);
          const visibleTrackIds = get().visibleTrackIds;
          const saved = await context.client.updateProject(
            record.id,
            {
              name: record.name,
              score,
              // zoom rides along because ProjectUiPrefs requires it. Changing
              // it deliberately does NOT mark the project dirty, so it
              // persists opportunistically on the next real save rather than
              // adding a write per click of the zoom button.
              uiPrefs: {
                zoom: get().zoom,
                ...(visibleTrackIds ? { visibleTrackIds } : {}),
              },
            },
            token,
          );
          currentRecord = saved;
          set((state) => {
            state.saveState = "saved";
            state.dirty = false;
          });
        } catch (err) {
          // Keep the dirty flag so the next change/flush retries; surface via toast.
          set((state) => {
            state.saveState = "unsaved";
          });
          get().pushToast({
            severity: "error",
            message:
              "Saving to the server failed. Your changes are kept locally — retry with Save.",
          });
          throw err;
        }
      });
      autosaver = next;
      return next;
    }

    /**
     * Flushes the *outgoing* project's autosaver before `adopt` reassigns
     * `currentRecord`: switching projects must never drop a pending
     * debounced write (spec §18). The save callback reads
     * `currentRecord`/`get()` at call time, so the flush must complete
     * before identity switches.
     */
    async function flushOutgoing(): Promise<void> {
      if (autosaver) {
        try {
          await autosaver.flush();
        } catch {
          // Already surfaced by the save callback's toast; don't block the switch.
        }
      }
    }

    async function adopt(record: ProjectRecord): Promise<void> {
      await flushOutgoing();
      currentRecord = record;
      attachAutosaver();
      set((state) => {
        state.projectId = record.id;
        state.projectName = record.name;
        state.dirty = false;
        state.saveState = "saved";
        // Reset, not merge: a track id means nothing outside the project it
        // came from, so carrying the outgoing project's hidden set into the
        // incoming one would hide arbitrary tracks.
        state.visibleTrackIds = record.uiPrefs?.visibleTrackIds ?? null;
        if (record.uiPrefs?.zoom) state.zoom = record.uiPrefs.zoom;
      });
      get().setScore(record.score, { resetHistory: true });
    }

    return {
      projectId: null,
      projectName: "",
      dirty: false,
      saveState: "saved",

      newProject: async (input) => {
        const score = input.score ?? createEmptyScore({ title: input.name });
        const token = await requireToken(context);
        const record = await context.client.createProject(
          { name: input.name, score },
          token,
        );
        await adopt(record);
      },

      openProject: async (id) => {
        const token = await requireToken(context);
        const record = await context.client.getProject(id, token);
        await adopt(record);
      },

      saveNow: async () => {
        if (!autosaver) return;
        await autosaver.flush();
      },

      markDirty: () => {
        set((state) => {
          state.dirty = true;
          state.saveState = "unsaved";
        });
        autosaver?.notifyChange();
      },

      renameProject: (name) => {
        if (!currentRecord) return;
        currentRecord = { ...currentRecord, name };
        set((state) => {
          state.projectName = name;
        });
        get().markDirty();
      },
    };
  };
}
