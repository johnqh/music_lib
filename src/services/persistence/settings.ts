/**
 * Reads/writes the `settings` key/value table (spec §18/§33: theme,
 * developer-mode toggle, mock-provider seed, undo/redo history-stack
 * limit). One row per `SettingsKey`; `getSetting` falls back to a
 * caller-supplied default when the row doesn't exist yet (a fresh
 * database, or a key introduced after the user's first run).
 */
import type { ScoreSmithDb, SettingsKey } from './db';

/** Reads one setting, falling back to `fallback` if unset. */
export async function getSetting<T>(db: ScoreSmithDb, key: SettingsKey, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

/** Writes (upserts) one setting. */
export async function setSetting(db: ScoreSmithDb, key: SettingsKey, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export type AppSettings = {
  theme: 'light' | 'dark' | 'system';
  developerMode: boolean;
  mockSeed: string;
  historyLimit: number | null;
};

/** Reads every developer/app setting at once, each falling back to `defaults`' corresponding field. Used to bootstrap `ui-slice` on app start. */
export async function loadAllSettings(db: ScoreSmithDb, defaults: AppSettings): Promise<AppSettings> {
  const [theme, developerMode, mockSeed, historyLimit] = await Promise.all([
    getSetting(db, 'theme', defaults.theme),
    getSetting(db, 'developerMode', defaults.developerMode),
    getSetting(db, 'mockSeed', defaults.mockSeed),
    getSetting(db, 'historyLimit', defaults.historyLimit),
  ]);
  return { theme, developerMode, mockSeed, historyLimit };
}
