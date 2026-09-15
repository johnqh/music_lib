/**
 * One store per open document, for either place a document can live.
 *
 * The native app edits several documents at once — tabs on a desktop — so it
 * cannot use the web app's single application store. It used to build a bare
 * editing store per document and save it itself: an autosaver of its own for
 * files, and a second set of calls for server projects that PUT the whole
 * score on every save, cleared the dirty flag on a write that had raced an
 * edit, reported no save state for a generation poll to read, and kept the
 * server's version on the side of the store rather than in it. Every one of
 * those rules already existed here, for the web app's project.
 *
 * So this is the same editing slices, the same saver and the same project
 * write, composed per document. What a document has beside its editing state:
 *
 * - **an origin** — `unsaved` (nowhere yet), `file` (a `.moo` at a uri, written
 *   through an injected `DocumentFileStorage`) or `project` (a server row).
 *   Saving asks the origin where the bytes go at the moment it saves, so a
 *   Save As or a Sync to server takes effect on the very next write;
 * - **the persistence state** a UI and a poller read — `dirty`, `saveState`,
 *   `serverUpdatedAt`, `lastGeneration` — with the web project's semantics;
 * - **the transport settings** a player binding writes
 *   (`TRANSPORT_SETTINGS_DEFAULTS`), so `bindPlayer` binds to it unchanged.
 *
 * Nothing here knows about tabs, recents or which document is in front: that
 * is the host's list of stores.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  createScoreSlice,
  createSelectionSlice,
  createTrackSlice,
  createUiSlice,
  TRANSPORT_SETTINGS_DEFAULTS,
} from '@sudobility/music_editing';
import type {
  EditingState,
  EditingStoreApi,
  SetScoreOptions,
  TransportSettings,
} from '@sudobility/music_editing';
import {
  parseProjectFile,
  serializeProjectFile,
} from '@sudobility/music_codecs';
import type {
  GenerationRecord,
  ProjectUiPrefs,
  Score,
} from '@sudobility/music_types';
import {
  authorizedServer,
  hasServer,
  toastSinkActions,
  type StoreContext,
} from './context.js';
import { createDocumentSaver } from '../services/persistence/document-saver.js';
import type {
  SaveState,
  SaveWrite,
} from '../services/persistence/document-saver.js';
import { projectWrite } from '../services/persistence/project-write.js';

/** Where a document's bytes live, and therefore what saving it means. */
export type DocumentOrigin =
  | { kind: 'unsaved' }
  | { kind: 'file'; uri: string }
  | { kind: 'project'; projectId: string };

/**
 * The filesystem, as far as a document needs one.
 *
 * Structural, so a test passes a map and each platform passes its own —
 * a sandboxed macOS build reaches a file through a security-scoped bookmark,
 * which is a different storage and not a different document.
 */
export type DocumentFileStorage = {
  readText(uri: string): Promise<string>;
  writeText(uri: string, text: string): Promise<void>;
};

/** Anything that can stop the transport: a player, a binding, the adapter. */
export type TransportStopper = { stop(): void };

export type DocumentSlice = {
  title: string;
  origin: DocumentOrigin;
  /** True once something worth saving changed since the last write. */
  dirty: boolean;
  saveState: SaveState;
  /**
   * The server's `updatedAt` as of the last read or write this store made, for
   * a project; null otherwise. How a poller tells this client's own writes
   * from somebody else's.
   */
  serverUpdatedAt: string | null;
  /** A project's last whole-score generation, for Generate Again. */
  lastGeneration: GenerationRecord | null;
  /** Whether the context can reach a server at all. Fixed for the store's life. */
  serverAvailable: boolean;

  /** Marks the document dirty and schedules a save. Called by every edit. */
  markDirty: () => void;
  /**
   * Writes anything pending now — a manual save, a flush before a generation
   * job or a close. A no-op when nothing is dirty or there is nowhere to write.
   */
  saveNow: () => Promise<void>;
  /** Records a server write made around the autosaver (a snapshot). */
  noteServerVersion: (updatedAt: string) => void;
  /** Renames the document; the title persists with the next save. */
  rename: (title: string) => void;
  /**
   * Writes the document to `uri` and moves it there, even when clean.
   *
   * Separate from `saveNow`, which never picks a place: Save As is the one
   * save with a person present to say where.
   */
  saveAs: (uri: string) => Promise<void>;
  /**
   * Creates a project from this document and moves it there, keeping its
   * identity and its undo history. Resolves to the new project's id.
   */
  syncToServer: () => Promise<string>;
  /**
   * Replaces the score with the server's copy — after a generation job wrote
   * to the project. Stops the transport first, resets the history, and leaves
   * the document clean.
   */
  reloadFromServer: (transport: TransportStopper) => Promise<void>;
  /** Stops scheduling saves. Flush first if the work matters. */
  dispose: () => void;
};

export type DocumentState = EditingState & TransportSettings & DocumentSlice;

export type CreateDocumentStoreOptions = {
  score: Score;
  title: string;
  /** Defaults to `unsaved`: an ordinary document that has never been written. */
  origin?: DocumentOrigin;
  /** The server, the token and the toast sink. Omit for a server-less host. */
  context?: StoreContext;
  /** Required to save a `file` origin; reads and writes go through it. */
  files?: DocumentFileStorage;
  /** For a project: where the server's copy stood when this was read. */
  serverUpdatedAt?: string | null;
  lastGeneration?: GenerationRecord | null;
  /** For a project: the per-project view state it was saved with. */
  uiPrefs?: ProjectUiPrefs;
  debounceMs?: number;
  /** Told after every successful write — a recents list, a title bar. */
  onSaved?: (saved: { origin: DocumentOrigin; title: string }) => void;
  /**
   * Whether opening this document moves the shared caret to its start.
   * Defaults to `false`.
   *
   * There is one playback position and it belongs to the document in front.
   * A document is usually opened into a tab, and moving the position then sent
   * the caret of whatever the reader was looking at back to bar 1. The host
   * that brings a document to the front puts the caret where that document
   * left it — or passes `true` for a document it opens straight into view.
   */
  resetPosition?: boolean;
};

/** Thrown when a file origin is saved with no file storage to save through. */
export class DocumentStorageMissingError extends Error {
  constructor() {
    super('A file document was saved with no DocumentFileStorage.');
    this.name = 'DocumentStorageMissingError';
  }
}

export function createDocumentStore(options: CreateDocumentStoreOptions) {
  const context: StoreContext = options.context ?? {};

  const store = create<DocumentState>()(
    immer((set, get) => {
      const changed = () => get().markDirty();

      const fileWrite =
        (uri: string): SaveWrite =>
        async ({ score }) => {
          if (!options.files) throw new DocumentStorageMissingError();
          const title = get().title;
          await options.files.writeText(
            uri,
            serializeProjectFile({ title, score })
          );
          options.onSaved?.({ origin: { kind: 'file', uri }, title });
        };

      const saver = createDocumentSaver<DocumentState>({
        set,
        get,
        debounceMs: options.debounceMs,
        destination: () => {
          const origin = get().origin;
          switch (origin.kind) {
            case 'unsaved':
              return null;
            case 'file':
              return fileWrite(origin.uri);
            case 'project':
              return projectWrite(
                context,
                () => origin.projectId,
                () => ({
                  name: get().title,
                  zoom: get().zoom,
                  visibleTrackIds: get().visibleTrackIds,
                }),
                () => options.onSaved?.({ origin, title: get().title })
              );
          }
        },
      });

      // A file and a project already hold the opening score, so a save that
      // only persists view state can leave it out. Without this the saver's
      // identity check starts empty and the first save of a just-opened
      // project ships a score the server already has.
      if (options.origin && options.origin.kind !== 'unsaved') {
        saver.adopted(options.score);
      }

      return {
        state: 'stopped' as const,
        ...TRANSPORT_SETTINGS_DEFAULTS,
        // A copy: immer freezes what the store holds, and this object is a
        // shared export.
        synthLoad: { ...TRANSPORT_SETTINGS_DEFAULTS.synthLoad },
        ...createScoreSlice<DocumentState>({ set, get, changed }),
        ...createSelectionSlice<DocumentState>({ set, get, changed }),
        ...createTrackSlice<DocumentState>({ set, get, changed }),
        ...createUiSlice<DocumentState>({ set, get, changed }),
        ...(context.toasts ? toastSinkActions(context.toasts) : {}),

        title: options.title,
        origin: options.origin ?? { kind: 'unsaved' },
        dirty: false,
        saveState: 'saved' as SaveState,
        serverUpdatedAt: options.serverUpdatedAt ?? null,
        lastGeneration: options.lastGeneration ?? null,
        serverAvailable: hasServer(context),

        markDirty: () => {
          set(state => {
            state.dirty = true;
            state.saveState = 'unsaved';
          });
          saver.notifyChange();
        },

        saveNow: () => saver.flush(),

        noteServerVersion: updatedAt => {
          set(state => {
            state.serverUpdatedAt = updatedAt;
          });
        },

        rename: title => {
          set(state => {
            state.title = title;
          });
          get().markDirty();
        },

        saveAs: async uri => {
          set(state => {
            state.origin = { kind: 'file', uri };
          });
          // Dirty first, so the flush has something to write even when the
          // document was clean: the point of Save As is the new file.
          get().markDirty();
          await saver.flush();
        },

        syncToServer: async () => {
          const score = get().score;
          if (!score) throw new Error('Cannot sync a document with no score.');
          const { client, token } = await authorizedServer(context);
          const project = await client.createProject(
            { name: get().title, score },
            token
          );
          saver.adopted(score);
          // Read outside the updater: inside it `state.score` is an immer
          // draft, which is never identical to the score it drafts.
          const unchanged = get().score === score;
          set(state => {
            state.origin = { kind: 'project', projectId: project.id };
            state.serverUpdatedAt = project.updatedAt;
            // Clean only if nothing moved while the project was being made;
            // otherwise the pending save now carries it to the project.
            if (unchanged) {
              state.dirty = false;
              state.saveState = 'saved';
            }
          });
          return project.id;
        },

        reloadFromServer: async transport => {
          const origin = get().origin;
          if (origin.kind !== 'project') return;
          const { client, token } = await authorizedServer(context);
          const record = await client.getProject(origin.projectId, token);
          adoptOutsideScore(store, record.score, transport, {
            resetHistory: true,
          });
          saver.adopted(record.score);
          set(state => {
            state.title = record.name;
            state.lastGeneration = record.lastGeneration ?? null;
            state.serverUpdatedAt = record.updatedAt;
            state.dirty = false;
            state.saveState = 'saved';
          });
        },

        dispose: () => saver.dispose(),
      };
    })
  );

  if (options.uiPrefs) {
    const prefs = options.uiPrefs;
    store.setState(state => {
      state.visibleTrackIds = prefs.visibleTrackIds ?? null;
      if (prefs.zoom) state.zoom = prefs.zoom;
    });
  }
  // An adoption, not an edit: `setScore` reports no change, so a freshly
  // opened document is clean.
  store.getState().setScore(options.score, {
    resetHistory: true,
    resetPosition: options.resetPosition ?? false,
  });
  return store;
}

export type DocumentStore = ReturnType<typeof createDocumentStore>;

/**
 * Opens a server project as a document.
 *
 * Reads return the score; the store is built from the record as read, clean,
 * with its server version, its last generation and its view prefs.
 */
export async function openProjectDocument(
  context: StoreContext,
  projectId: string,
  options: Omit<
    CreateDocumentStoreOptions,
    'score' | 'title' | 'origin' | 'context'
  > = {}
): Promise<DocumentStore> {
  const { client, token } = await authorizedServer(context);
  const record = await client.getProject(projectId, token);
  return createDocumentStore({
    ...options,
    score: record.score,
    title: record.name,
    origin: { kind: 'project', projectId },
    context,
    serverUpdatedAt: record.updatedAt,
    lastGeneration: record.lastGeneration ?? null,
    ...(record.uiPrefs ? { uiPrefs: record.uiPrefs } : {}),
  });
}

/**
 * Opens a project file as a document — either shape the apps have written
 * (`parseProjectFile` reads the native `.moo` and the web's JSON export).
 * Throws `ProjectFileError` for a file it cannot vouch for.
 */
export async function openFileDocument(
  files: DocumentFileStorage,
  uri: string,
  options: Omit<
    CreateDocumentStoreOptions,
    'score' | 'title' | 'origin' | 'files'
  > = {}
): Promise<DocumentStore> {
  const file = parseProjectFile(await files.readText(uri));
  return createDocumentStore({
    ...options,
    score: file.score,
    title: file.title,
    origin: { kind: 'file', uri },
    files,
  });
}

export type AdoptOutsideScoreOptions = SetScoreOptions & {
  /** The server version the adopted score came from, when it came from one. */
  serverUpdatedAt?: string;
};

/**
 * Puts a score that did not come from an edit into a store — a generation
 * result, an opened snapshot — stopping the transport first.
 *
 * The order is the whole point. Every edit goes through `dispatchCommand`,
 * which refuses content changes while playing; a score arriving from outside
 * does not, so the lock never sees it, and a player still running would read
 * the swap as a mix change and go on playing the old score out of its queue.
 * Stopping first keeps "while playing, the only score change is a mix change"
 * true by construction, which is what the player's no-reload branch rests on.
 */
export function adoptOutsideScore<
  T extends EditingState & { noteServerVersion?: (updatedAt: string) => void },
>(
  store: EditingStoreApi<T>,
  score: Score,
  transport: TransportStopper,
  options: AdoptOutsideScoreOptions = {}
): void {
  const { serverUpdatedAt, ...setOptions } = options;
  transport.stop();
  store.getState().setScore(score, setOptions);
  // This client made that change and is showing the result; saying so is what
  // stops a generation poll reading the new stamp as somebody else's write.
  if (serverUpdatedAt) store.getState().noteServerVersion?.(serverUpdatedAt);
}
