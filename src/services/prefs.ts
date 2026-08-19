/**
 * Device-level preference persistence (theme, view, zoom, snap grid,
 * developer settings) via the injected PrefsStorage (structurally
 * @sudobility/di's StorageService). Replaces the deleted Dexie settings
 * table — projects live server-side now; only device prefs stay local.
 */
import type { PrefsStorage } from '../store/context.js';

const PREFS_KEY = 'scoresmith.prefs.v1';

export type DevicePrefs = {
  themeMode?: 'light' | 'dark' | 'system';
  view?: 'notation' | 'piano-roll';
  zoom?: number;
  snapGrid?: string;
  pitchDisplay?: 'concert' | 'written';
  developerMode?: boolean;
  devSettings?: Record<string, unknown>;
};

export async function loadPrefs(storage: PrefsStorage): Promise<DevicePrefs> {
  try {
    const raw = await storage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as DevicePrefs) : {};
  } catch {
    return {};
  }
}

export async function savePrefs(
  storage: PrefsStorage,
  prefs: DevicePrefs
): Promise<void> {
  try {
    await storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Prefs persistence is best-effort; never break the app over it.
  }
}
