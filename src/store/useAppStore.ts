/**
 * The composed application store (spec §3, §37.13): one Zustand store built
 * from the slices in `store/slices/*`, wired with Immer so every action
 * writes to a mutable-looking draft (`set((state) => { state.x = ... })`)
 * while the store itself stays immutable underneath.
 *
 * `createAppStore(options)` is the real factory — it exists (rather than
 * only exporting a ready-made singleton) so tests can supply their own
 * `ScoreSmithDb` (typically an in-memory `fake-indexeddb` instance, per
 * this codebase's persistence-layer DI convention) instead of the real
 * IndexedDB-backed one `useAppStore` uses. `useAppStore` is that ready-made
 * singleton, for the running app.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { createDb } from '../services/persistence/db';
import type { ScoreSmithDb } from '../services/persistence/db';
import { createScoreSlice } from './slices/score-slice';
import type { ScoreSlice } from './slices/score-slice';
import { createSelectionSlice } from './slices/selection-slice';
import type { SelectionSlice } from './slices/selection-slice';
import { createPlaybackSlice } from './slices/playback-slice';
import type { PlaybackSlice } from './slices/playback-slice';
import { createGenerationSlice } from './slices/generation-slice';
import type { GenerationSlice } from './slices/generation-slice';
import { createProjectSlice } from './slices/project-slice';
import type { ProjectSlice } from './slices/project-slice';
import { createUiSlice } from './slices/ui-slice';
import type { UiSlice } from './slices/ui-slice';

export type AppState = ScoreSlice &
  SelectionSlice &
  PlaybackSlice &
  GenerationSlice &
  ProjectSlice &
  UiSlice;

export type CreateAppStoreOptions = {
  /** The persistence backend `project-slice` reads/writes. Defaults to a real IndexedDB-backed `ScoreSmithDb`; tests should pass one constructed against `fake-indexeddb`. */
  db?: ScoreSmithDb;
};

/** Builds a fresh, independent app store. Every store gets its own `HistoryManager` (see `score-slice.ts`) and its own autosaver (see `project-slice.ts`) — nothing here is a cross-store singleton except the generation-provider registry (`services/generation/registry.ts`), which is intentionally process-wide. */
export function createAppStore(options: CreateAppStoreOptions = {}) {
  const db = options.db ?? createDb();

  return create<AppState>()(
    immer((set, get, api) => ({
      ...createScoreSlice(set, get, api),
      ...createSelectionSlice(set, get, api),
      ...createPlaybackSlice(set, get, api),
      ...createGenerationSlice(set, get, api),
      ...createProjectSlice(db)(set, get, api),
      ...createUiSlice(set, get, api),
    })),
  );
}

/**
 * The real IndexedDB-backed `ScoreSmithDb` behind the app-wide store
 * (below). Exported (not just closed over) so app-shell code that needs
 * direct `db` access for something outside `project-slice`'s own
 * CRUD/autosave (project-JSON import/export, the developer-settings
 * "reset local database" action) can share the exact same connection
 * rather than opening a second one against the same underlying database.
 */
export const db: ScoreSmithDb = createDb();

/** The app's single running store instance, backed by `db` above. */
export const useAppStore = createAppStore({ db });
