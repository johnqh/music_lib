/**
 * Project slice (spec §18, §19): project identity (`projectId`/
 * `projectName`), dirty/save-state tracking, and the actions that create/
 * open/save a project — now against music_api via the injected
 * `StoreContext`'s MusicClient (server-side persistence replaced Dexie in
 * Phase 2). Debounced autosave is retained via `createAutosaver`: every
 * mutation that goes through `score-slice` calls `markDirty()`, which
 * notifies the autosaver; the autosaver's save PUTs the name, the ui prefs
 * and — only when it has actually changed — the score to `/projects/:id`.
 *
 * A write returns metadata rather than a record, so the score travels in one
 * direction per save instead of two, and `serverUpdatedAt` records where the
 * server's copy stands so a poller can tell this client's own writes from
 * somebody else's.
 */
import { libraryMessage } from '../../services/messages.js';
import type { StateCreator } from 'zustand';
import { createEmptyScore } from '@sudobility/music_types';
import type {
  ProjectSaveResult,
  ProjectUpdateRequest,
  Score,
} from '@sudobility/music_types';
import { createAutosaver } from '../../services/persistence/autosave.js';
import type { Autosaver } from '../../services/persistence/autosave.js';
import { authorizedServer, hasServer, type StoreContext } from '../context.js';
import type { AppState } from '../useAppStore.js';

export type SaveState = 'saved' | 'saving' | 'unsaved';

export type NewProjectInput = { name: string; score?: Score };

export type ProjectSlice = {
  projectId: string | null;
  projectName: string;
  dirty: boolean;
  saveState: SaveState;
  /**
   * The server's `updatedAt` as of the last read or write this store made.
   *
   * Exists so a client can tell **its own** writes from somebody else's. A
   * poller watching `updatedAt` for "did a generation land" otherwise sees
   * every autosave as a foreign change and re-downloads the project it just
   * uploaded — which also throws away the undo history. Null before a project
   * is open.
   */
  serverUpdatedAt: string | null;
  /**
   * Whether this store has a server behind it at all.
   *
   * Read it to decide what to *offer*, not to decide what to catch: a host
   * that hides the project, generation and publishing affordances when this is
   * false never reaches `ServerUnavailableError`. Fixed for the life of the
   * store — a host does not gain a server halfway through.
   */
  serverAvailable: boolean;

  /** Creates and persists a brand-new project on the server, then loads its score (fresh undo history) into `score-slice`. */
  newProject: (input: NewProjectInput) => Promise<void>;
  /** Loads an existing project by id from the server, then loads its score (fresh undo history) into `score-slice`. */
  openProject: (id: string) => Promise<void>;
  /** Flushes any pending autosave immediately (spec §18: "manual save"). No-op if nothing is dirty or no project is open. */
  saveNow: () => Promise<void>;
  /** Marks the current project dirty and notifies the autosaver. Called by `score-slice` after every `dispatchCommand`/`undo`/`redo`; not normally called directly by UI code. */
  markDirty: () => void;
  /**
   * Records that the server's copy is at `updatedAt` and that this client
   * already has what it says.
   *
   * For the writes that go around the autosaver — opening a snapshot, or
   * creating one, which re-parents the project row. Without it a poller
   * watching `serverUpdatedAt` reads the change this client just made as a
   * foreign one and reloads a project it is already showing.
   */
  noteServerVersion: (updatedAt: string) => void;
  /** Renames the currently-open project. The new name persists on the next autosave/`saveNow()` flush. No-op if no project is open. */
  renameProject: (name: string) => void;
};

export function createProjectSlice(
  context: StoreContext
): StateCreator<AppState, [['zustand/immer', never]], [], ProjectSlice> {
  return (set, get) => {
    let currentProject: ProjectSaveResult | null = null;
    let autosaver: Autosaver | null = null;
    /**
     * The exact score object the server was last given (or handed us).
     *
     * Identity, not a deep compare: every mutation goes through a command that
     * returns a new score, so an unchanged reference *is* an unchanged score.
     * It is what lets a save that exists only to persist a hidden-track list
     * leave the score — the largest thing this app owns — out of the request.
     */
    let lastSavedScore: Score | null = null;

    function attachAutosaver(): Autosaver {
      autosaver?.dispose();
      const next = createAutosaver(async () => {
        const project = currentProject;
        const score = get().score;
        if (!project || !score) return;
        set(state => {
          state.saveState = 'saving';
        });
        try {
          const { client, token } = await authorizedServer(context);
          const visibleTrackIds = get().visibleTrackIds;
          const body: ProjectUpdateRequest = {
            name: project.name,
            // Omitted when the score has not moved since the last save. A
            // visibility toggle marks the project dirty like any other change,
            // and used to ship the entire score to record a list of track ids.
            ...(score === lastSavedScore ? {} : { score }),
            // zoom rides along because ProjectUiPrefs requires it. Changing
            // it deliberately does NOT mark the project dirty, so it
            // persists opportunistically on the next real save rather than
            // adding a write per click of the zoom button.
            uiPrefs: {
              zoom: get().zoom,
              ...(visibleTrackIds ? { visibleTrackIds } : {}),
            },
          };
          const saved = await client.updateProject(project.id, body, token);
          currentProject = saved;
          lastSavedScore = score;
          set(state => {
            state.saveState = 'saved';
            state.dirty = false;
            // Recorded so a status poll can recognise this write as ours.
            state.serverUpdatedAt = saved.updatedAt;
          });
        } catch (err) {
          // Keep the dirty flag so the next change/flush retries; surface via toast.
          set(state => {
            state.saveState = 'unsaved';
          });
          get().pushToast({
            severity: 'error',
            message: libraryMessage('saveFailed'),
          });
          throw err;
        }
      });
      autosaver = next;
      return next;
    }

    /**
     * Flushes the *outgoing* project's autosaver before `adopt` reassigns
     * `currentProject`: switching projects must never drop a pending
     * debounced write (spec §18). The save callback reads
     * `currentProject`/`get()` at call time, so the flush must complete
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

    /**
     * Takes over a project.
     *
     * The score is a separate argument because a *write* no longer returns
     * one: creating a project echoes back everything except the score the
     * caller just sent, so the caller supplies the copy it already has.
     */
    async function adopt(
      project: ProjectSaveResult,
      score: Score
    ): Promise<void> {
      await flushOutgoing();
      currentProject = project;
      lastSavedScore = score;
      attachAutosaver();
      set(state => {
        state.projectId = project.id;
        state.projectName = project.name;
        state.dirty = false;
        state.saveState = 'saved';
        state.serverUpdatedAt = project.updatedAt;
        // Reset, not merge: a track id means nothing outside the project it
        // came from, so carrying the outgoing project's hidden set into the
        // incoming one would hide arbitrary tracks.
        state.visibleTrackIds = project.uiPrefs?.visibleTrackIds ?? null;
        if (project.uiPrefs?.zoom) state.zoom = project.uiPrefs.zoom;
      });
      get().setScore(score, { resetHistory: true });
    }

    return {
      projectId: null,
      projectName: '',
      dirty: false,
      saveState: 'saved',
      serverUpdatedAt: null,
      serverAvailable: hasServer(context),

      newProject: async input => {
        const score = input.score ?? createEmptyScore({ title: input.name });
        const { client, token } = await authorizedServer(context);
        const created = await client.createProject(
          { name: input.name, score },
          token
        );
        // The score we just sent, not one shipped back to us: the server
        // stored exactly this, and re-downloading it would double the cost of
        // creating a project.
        await adopt(created, score);
      },

      openProject: async id => {
        const { client, token } = await authorizedServer(context);
        const record = await client.getProject(id, token);
        await adopt(record, record.score);
      },

      saveNow: async () => {
        if (!autosaver) return;
        await autosaver.flush();
      },

      markDirty: () => {
        set(state => {
          state.dirty = true;
          state.saveState = 'unsaved';
        });
        autosaver?.notifyChange();
      },

      noteServerVersion: updatedAt => {
        set(state => {
          state.serverUpdatedAt = updatedAt;
        });
      },

      renameProject: name => {
        if (!currentProject) return;
        currentProject = { ...currentProject, name };
        set(state => {
          state.projectName = name;
        });
        get().markDirty();
      },
    };
  };
}
