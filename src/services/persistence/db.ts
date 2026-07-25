/**
 * Dexie/IndexedDB database definition (spec §18). `ScoreSmithDb` exposes two
 * tables:
 *
 * - `projects`: one row per saved project (`ProjectRecord`), indexed by
 *   `id` (primary key), `name`, `updatedAt`, and `createdAt` so
 *   `listProjects` (`projects.ts`) can sort by name or last-modified
 *   without an in-memory scan.
 * - `settings`: a small key/value table for app-level developer settings
 *   (spec §33): theme, developerMode, mockSeed, historyLimit.
 *
 * `ProjectRecord` and its Zod counterpart `projectRecordSchema` are
 * co-located here (rather than in `projects.ts`/`migrations.ts`) so there is
 * exactly one place that defines "what a persisted project looks like";
 * every other persistence module imports from here.
 *
 * Kept free of React/MUI/VexFlow/Tone.js (spec §3, §37) — Dexie/IndexedDB
 * are the one browser-only dependency this module intentionally takes, and
 * only this module (plus its siblings in `services/persistence/`) may.
 */
import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import { scoreSchema } from '@sudobility/music_types';
import type { Score } from '@sudobility/music_types';

export type UiPrefs = { view: 'notation' | 'piano-roll'; zoom: number };

export type ProjectThumbnail = {
  measureCount: number;
  trackNames: string[];
  durationSeconds: number;
};

export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  score: Score;
  uiPrefs?: UiPrefs;
  thumbnail?: ProjectThumbnail;
};

export const uiPrefsSchema = z.object({
  view: z.enum(['notation', 'piano-roll']),
  zoom: z.number().positive(),
});

export const projectThumbnailSchema = z.object({
  measureCount: z.number().int().nonnegative(),
  trackNames: z.array(z.string()),
  durationSeconds: z.number().nonnegative(),
});

/** Validates a persisted (or imported) `ProjectRecord`. Unknown keys are stripped, not rejected, so forward-compatible additions don't break loading older builds. */
export const projectRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.number().int().nonnegative(),
  score: scoreSchema,
  uiPrefs: uiPrefsSchema.optional(),
  thumbnail: projectThumbnailSchema.optional(),
});

/** Developer-settings keys (spec §33): mock-provider seed, developer-mode toggle, UI theme, and undo/redo history-stack limit. */
export type SettingsKey = 'theme' | 'developerMode' | 'mockSeed' | 'historyLimit';

export type SettingRecord = { key: SettingsKey; value: unknown };

/**
 * Options forwarded to Dexie's constructor. Only `indexedDB`/`IDBKeyRange`
 * are exposed (not the full `DexieOptions`) — the one thing a test needs is
 * to point Dexie at `fake-indexeddb`'s in-memory implementation instead of
 * (or in addition to) `import 'fake-indexeddb/auto'` globally patching
 * `globalThis.indexedDB`.
 */
export type ScoreSmithDbOptions = {
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
};

const DEFAULT_DB_NAME = 'scoresmith';

export class ScoreSmithDb extends Dexie {
  projects!: Table<ProjectRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor(name: string = DEFAULT_DB_NAME, options?: ScoreSmithDbOptions) {
    super(name, options);
    this.version(1).stores({
      projects: 'id, name, updatedAt, createdAt',
      settings: 'key',
    });
  }
}

/** Convenience factory mirroring `new ScoreSmithDb(...)`, for call sites that prefer a function over `new`. */
export function createDb(name?: string, options?: ScoreSmithDbOptions): ScoreSmithDb {
  return new ScoreSmithDb(name, options);
}
