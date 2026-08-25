/**
 * The composed application store (spec §3, §37.13): one Zustand store built
 * from the slices in `store/slices/*`, wired with Immer.
 *
 * Phase 2: the store closes over an injected `StoreContext` (MusicClient +
 * token getter) instead of a Dexie handle. `createAppStore` stays the
 * test-facing factory; the running app calls `initializeAppStore(context)`
 * once at bootstrap, after which the `useAppStore` hook (and its
 * `getState`/`setState`/`subscribe` statics) delegate to that instance.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { StoreContext } from './context.js';
import {
  createScoreSlice,
  createSelectionSlice,
  createTrackSlice,
  createUiSlice,
} from '@sudobility/music_editing';
import type { EditingState } from '@sudobility/music_editing';
import { createPlaybackSlice } from './slices/playback-slice.js';
import type { PlaybackSlice } from './slices/playback-slice.js';
import { createGenerationSlice } from './slices/generation-slice.js';
import type { GenerationSlice } from './slices/generation-slice.js';
import { createProjectSlice } from './slices/project-slice.js';
import type { ProjectSlice } from './slices/project-slice.js';

/**
 * The web app's single store: the editing state plus everything an app needs
 * around it.
 *
 * It satisfies `EditingState` by construction — the editing slices are in it,
 * `PlaybackSlice` supplies the `state` field the edit lock reads, and
 * `ProjectSlice` supplies `markDirty` — which is what lets the same slices be
 * composed here and, unchanged, into a store holding one document and nothing
 * else.
 */
export type AppState = EditingState &
  PlaybackSlice &
  GenerationSlice &
  ProjectSlice;

export type CreateAppStoreOptions = {
  /** The backend context (MusicClient, token getter, prefs storage). */
  context: StoreContext;
};

export type AppStore = ReturnType<typeof createAppStore>;

/** Builds a fresh, independent app store closed over `options.context`. Every store gets its own `HistoryManager` and autosaver. */
export function createAppStore(options: CreateAppStoreOptions) {
  const { context } = options;

  return create<AppState>()(
    immer((set, get, api) => {
      /*
        What THIS app does when the editing engine says something changed:
        tell the autosaver. That is `project-slice`'s job, not editing's — the
        engine is handed a callback and knows nothing about projects, servers
        or debounce windows, which is exactly what lets the same slices run in
        a native app that saves to a file, or to nothing at all.
      */
      const changed = () => get().markDirty();

      return {
        /*
          The four editing slices come from `@sudobility/music_editing`, and
          they are composed here into a state carrying much more than they know
          about. That is the point of the split: the same slices make a native
          app's per-document store, where there is no playback, generation or
          project state beside them.
        */
        ...createScoreSlice<AppState>({ set, get, changed }),
        ...createSelectionSlice<AppState>({ set, get, changed }),
        ...createTrackSlice<AppState>({ set, get, changed }),
        ...createUiSlice<AppState>({ set, get, changed }),
        ...createPlaybackSlice(set, get, api),
        ...createGenerationSlice(context)(set, get, api),
        ...createProjectSlice(context)(set, get, api),
      };
    })
  );
}

let appStore: AppStore | null = null;

/** Creates (or replaces) the app-wide store instance. Call once at app bootstrap, before any component renders `useAppStore`. */
export function initializeAppStore(context: StoreContext): AppStore {
  appStore = createAppStore({ context });
  return appStore;
}

export function getAppStore(): AppStore {
  if (!appStore) {
    throw new Error(
      'App store not initialized - call initializeAppStore(context) at bootstrap.'
    );
  }
  return appStore;
}

type UseAppStoreHook = {
  (): AppState;
  <T>(selector: (state: AppState) => T): T;
  getState: () => AppState;
  getInitialState: () => AppState;
  setState: AppStore['setState'];
  subscribe: AppStore['subscribe'];
};

/**
 * App-wide store hook, delegating to the instance created by
 * `initializeAppStore`. Components use it exactly like a plain zustand
 * hook (`useAppStore(selector)`, `useAppStore.getState()`).
 */
export const useAppStore: UseAppStoreHook = Object.assign(
  // `any` is unavoidable here: the callable half of the hook is generic over
  // the selector's return type, and `Object.assign` cannot preserve that
  // generic through the intersection it builds. The declared `UseAppStoreHook`
  // is what callers actually see.
  // The directive sits *inside* the expression, not above it: the cast is at
  // the end of a multi-line arrow, so a directive placed above the whole thing
  // lands on the opening row rather than the row carrying the `any`. Getting
  // that wrong is what left this file reporting the `any` and an unused
  // directive at the same time — the suppression missed, and then reported
  // itself as pointless.
  (<T>(selector?: (state: AppState) => T) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selector ? getAppStore()(selector) : getAppStore()()) as any,
  {
    getState: () => getAppStore().getState(),
    getInitialState: () => getAppStore().getInitialState(),
    setState: ((...args: Parameters<AppStore['setState']>) =>
      getAppStore().setState(...args)) as AppStore['setState'],
    subscribe: ((...args: Parameters<AppStore['subscribe']>) =>
      getAppStore().subscribe(...args)) as AppStore['subscribe'],
  }
);

/**
 * The store an editing operation is handed in THIS app.
 *
 * `@sudobility/music_editing` publishes the generic handle; binding it to the
 * composed state is the consumer's job, and music_app has fifty files that say
 * `EditorStoreApi` and mean "the app's store". Naming it here keeps every one
 * of them true.
 */
export type EditorStoreApi = ReturnType<typeof createAppStore>;
