/**
 * Device prefs: how this person likes to work, on this device.
 *
 * Theme, developer mode, the pitch notation is shown in, whether the piano
 * keyboard is collapsed, the font size and the language. Device-scoped rather
 * than per project — they mean the same thing in every score — and persisted
 * through the injected `PrefsStorage` (structurally @sudobility/di's
 * StorageService), so each platform brings its own storage and a test brings a
 * map.
 *
 * The two apps each kept their own subset: the web persisted three of these
 * under this key and the font size under a key of its own; the native app
 * persisted none and started its keyboard collapsed. One validated shape now,
 * one set of defaults — the keyboard starts **expanded** on both — and one
 * binding that loads them into a store and writes them back.
 *
 * **Read defensively, field by field.** A stored value was written by whatever
 * build wrote it, or edited by hand; an invalid field falls back to its default
 * without taking the valid ones with it. **Written without losing anything**:
 * a save merges into the stored object, so a field an older build kept (`zoom`,
 * `view`) or a newer build added survives a save from this one.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { FONT_SIZES, THEME_MODES } from '@sudobility/music_types';
import type {
  DevSettings,
  DevicePrefs,
  FontSize,
  PitchDisplay,
  PrefsStorage,
  ResolvedThemeMode,
  ThemeMode,
} from '@sudobility/music_types';

/** Where the prefs object lives. The web app's key from before this module, kept so nothing stored is stranded. */
export const PREFS_KEY = 'scoresmith.prefs.v1';

/**
 * Where the web app kept the font size before it was a device pref.
 *
 * Read only as a fallback when the prefs object has no font size, so a reader
 * who chose one before the move keeps it. Never written.
 */
export const LEGACY_FONT_SIZE_KEY = 'moosiac-font-size';

/**
 * Where the native app kept the theme before it was a device pref.
 *
 * Read only as a fallback when the prefs object has no theme, so a reader who
 * chose dark on the Mac is not put back on "system" by the move. Never written.
 */
export const LEGACY_THEME_MODE_KEY = 'moosiac.themeMode';

export const DEFAULT_DEVICE_PREFS: DevicePrefs = {
  themeMode: 'system',
  developerMode: false,
  pitchDisplay: 'concert',
  keyboardCollapsed: false,
  fontSize: 'medium',
  language: null,
};

/**
 * The keys a pref binding reads and writes, in one place.
 *
 * Typed off `DevicePrefs` through a record, so a seventh pref fails to compile
 * here rather than silently going unpersisted.
 */
const PREF_FIELDS: Record<keyof DevicePrefs, true> = {
  themeMode: true,
  developerMode: true,
  pitchDisplay: true,
  keyboardCollapsed: true,
  fontSize: true,
  language: true,
};
export const DEVICE_PREF_KEYS = Object.keys(PREF_FIELDS) as ReadonlyArray<
  keyof DevicePrefs
>;

/** A record rather than a list, so a third display fails to compile here. */
const PITCH_DISPLAY_VALUES: Record<PitchDisplay, true> = {
  concert: true,
  written: true,
};

function oneOf<T extends string>(
  values: readonly T[],
  value: unknown
): value is T {
  return (
    typeof value === 'string' && (values as readonly string[]).includes(value)
  );
}

/** A primary language subtag and optional further subtags: `en`, `zh-Hans`, `pt-BR`. */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/** Validates each field on its own; anything unusable becomes its default. */
export function parseDevicePrefs(raw: unknown): DevicePrefs {
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const d = DEFAULT_DEVICE_PREFS;
  return {
    themeMode: oneOf(THEME_MODES, record.themeMode)
      ? record.themeMode
      : d.themeMode,
    developerMode:
      typeof record.developerMode === 'boolean'
        ? record.developerMode
        : d.developerMode,
    pitchDisplay: oneOf(
      Object.keys(PITCH_DISPLAY_VALUES) as PitchDisplay[],
      record.pitchDisplay
    )
      ? record.pitchDisplay
      : d.pitchDisplay,
    keyboardCollapsed:
      typeof record.keyboardCollapsed === 'boolean'
        ? record.keyboardCollapsed
        : d.keyboardCollapsed,
    fontSize: oneOf(FONT_SIZES, record.fontSize) ? record.fontSize : d.fontSize,
    language:
      typeof record.language === 'string' && LANGUAGE_TAG.test(record.language)
        ? record.language
        : d.language,
  };
}

async function readStored(
  storage: PrefsStorage
): Promise<Record<string, unknown>> {
  try {
    const raw = await storage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function loadPrefs(storage: PrefsStorage): Promise<DevicePrefs> {
  const stored = await readStored(storage);
  if (!oneOf(FONT_SIZES, stored.fontSize)) {
    try {
      const legacy = await storage.getItem(LEGACY_FONT_SIZE_KEY);
      if (oneOf(FONT_SIZES, legacy)) stored.fontSize = legacy;
    } catch {
      // The fallback is a courtesy; the default is fine.
    }
  }
  if (!oneOf(THEME_MODES, stored.themeMode)) {
    try {
      const legacy = await storage.getItem(LEGACY_THEME_MODE_KEY);
      if (oneOf(THEME_MODES, legacy)) stored.themeMode = legacy;
    } catch {
      // The fallback is a courtesy; the default is fine.
    }
  }
  return parseDevicePrefs(stored);
}

/**
 * Merges `prefs` into what is stored.
 *
 * Best-effort: prefs persistence never breaks the app. Two concurrent calls
 * can race their read-merge-write; `bindDevicePrefs` queues its own saves, so
 * a host that saves through it never meets that.
 */
export async function savePrefs(
  storage: PrefsStorage,
  prefs: Partial<DevicePrefs>
): Promise<void> {
  try {
    const stored = await readStored(storage);
    await storage.setItem(PREFS_KEY, JSON.stringify({ ...stored, ...prefs }));
  } catch {
    // Prefs persistence is best-effort; never break the app over it.
  }
}

/**
 * The developer switches' defaults. Not a persisted pref — developer mode is,
 * and these are what it reveals — but device state in the same sense: nothing
 * about a score, so nothing an edit reads.
 *
 * **Deliberately not in `DEVICE_PREF_KEYS`**, so nothing here is ever written to
 * storage. That is what makes removing a setting free: the six overlay toggles
 * that lived here and were read by nothing left no stored keys behind, and a
 * stored object that somehow carries one is ignored by `parseDevicePrefs`,
 * which builds its answer field by field.
 */
export const DEFAULT_DEV_SETTINGS: DevSettings = {
  generationVariant: 'default',
};

/** The setters for every pref editing does not hold. */
export type DevicePrefsActions = {
  setThemeMode: (mode: ThemeMode) => void;
  setDeveloperMode: (enabled: boolean) => void;
  /** Merges `patch` into `devSettings`. */
  setDevSettings: (patch: Partial<DevSettings>) => void;
  setKeyboardCollapsed: (collapsed: boolean) => void;
  setFontSize: (size: FontSize) => void;
  setLanguage: (language: string | null) => void;
};

/**
 * The five prefs the editing store does not hold, plus the developer settings,
 * as a slice.
 *
 * Pitch display lives in music_editing's ui slice, because note entry reads it.
 * The theme, developer mode, the keyboard, the font size and the language are
 * read by nothing but the UI and the canvas host, so they are here — composed
 * into the web app's store so one binding persists all six, and into
 * `createDevicePrefsStore` for a host whose editing stores are per document.
 */
export type DevicePrefsSlice = Omit<DevicePrefs, 'pitchDisplay'> & {
  devSettings: DevSettings;
} & DevicePrefsActions;

export function createDevicePrefsSlice<T extends DevicePrefsSlice>(
  set: (updater: (draft: T) => void) => void
): DevicePrefsSlice {
  return {
    themeMode: DEFAULT_DEVICE_PREFS.themeMode,
    developerMode: DEFAULT_DEVICE_PREFS.developerMode,
    devSettings: { ...DEFAULT_DEV_SETTINGS },
    keyboardCollapsed: DEFAULT_DEVICE_PREFS.keyboardCollapsed,
    fontSize: DEFAULT_DEVICE_PREFS.fontSize,
    language: DEFAULT_DEVICE_PREFS.language,
    setThemeMode: mode =>
      set(state => {
        state.themeMode = mode;
      }),
    setDeveloperMode: enabled =>
      set(state => {
        state.developerMode = enabled;
      }),
    setDevSettings: patch =>
      set(state => {
        Object.assign(state.devSettings, patch);
      }),
    setKeyboardCollapsed: collapsed =>
      set(state => {
        state.keyboardCollapsed = collapsed;
      }),
    setFontSize: size =>
      set(state => {
        state.fontSize = size;
      }),
    setLanguage: language =>
      set(state => {
        state.language = language;
      }),
  };
}

export type DevicePrefsState = DevicePrefsSlice & {
  pitchDisplay: PitchDisplay;
  setPitchDisplay: (display: PitchDisplay) => void;
};

/**
 * All six prefs as a store of their own.
 *
 * For a host whose editing stores are per document — the native app — where
 * device prefs cannot live in any one of them. The web app's single store
 * carries them already and binds that instead.
 */
export function createDevicePrefsStore() {
  return create<DevicePrefsState>()(
    immer(set => ({
      ...DEFAULT_DEVICE_PREFS,
      ...createDevicePrefsSlice<DevicePrefsState>(set),
      setPitchDisplay: display =>
        set(state => {
          state.pitchDisplay = display;
        }),
    }))
  );
}

export type DevicePrefsStore = ReturnType<typeof createDevicePrefsStore>;

/** The part of a store a pref binding needs. */
export type BindableDevicePrefsStore<T extends DevicePrefs> = {
  getState: () => T;
  setState: (updater: (draft: T) => void) => void;
  subscribe: (listener: (state: T, previous: T) => void) => () => void;
};

export type DevicePrefsBinding = {
  /** Resolves once the stored prefs are in the store. */
  ready: Promise<void>;
  unbind: () => void;
};

/**
 * Loads the stored prefs into `store`, then writes them back whenever one of
 * them changes.
 *
 * **Nothing is written until the load has landed**, so the store's defaults
 * can never overwrite what was stored before the read came back. A change made
 * in that window is overwritten by the stored value — it is a fraction of a
 * second at start-up, and the alternative is guessing which of two values the
 * reader meant.
 *
 * Saves are queued, one after another, so a quick run of toggles lands in the
 * order it was made.
 */
export function bindDevicePrefs<T extends DevicePrefs>(
  store: BindableDevicePrefsStore<T>,
  storage: PrefsStorage
): DevicePrefsBinding {
  let unbound = false;
  let unsubscribe: (() => void) | null = null;
  let queue: Promise<void> = Promise.resolve();

  const pick = (state: T): DevicePrefs => {
    const out = {} as Record<keyof DevicePrefs, unknown>;
    for (const key of DEVICE_PREF_KEYS) out[key] = state[key];
    return out as DevicePrefs;
  };

  const ready = loadPrefs(storage).then(prefs => {
    if (unbound) return;
    store.setState(draft => {
      Object.assign(draft, prefs);
    });
    unsubscribe = store.subscribe((state, previous) => {
      if (DEVICE_PREF_KEYS.every(key => state[key] === previous[key])) return;
      const snapshot = pick(state);
      queue = queue.then(() => savePrefs(storage, snapshot));
    });
  });

  return {
    ready,
    unbind: () => {
      unbound = true;
      unsubscribe?.();
    },
  };
}

/**
 * The prefs editing itself reads, and so each document store holds.
 *
 * Only the pitch display: note entry inverts the written-pitch lens. The theme
 * and developer mode used to be mirrored too, while they lived in the editing
 * ui slice; no edit reads either, so they are the device-prefs store's alone.
 */
export const EDITING_PREF_KEYS = ['pitchDisplay'] as const;

type EditingPrefs = Pick<DevicePrefs, (typeof EDITING_PREF_KEYS)[number]>;

/**
 * Keeps a document store's editing prefs equal to the device's.
 *
 * A host with a store per document keeps device prefs in a store of their own
 * (`createDevicePrefsStore`), because they belong to no one document. But one
 * of them is read by editing — note entry inverts the written-pitch lens — and
 * editing reads it off the document's own store. Copied on bind and on every change, so a document opened after the
 * reader switched to written pitch is in written pitch too, and none of the
 * open documents disagree with the setting.
 *
 * One way only: the document stores are not where the prefs are set.
 */
export function mirrorDevicePrefs<T extends EditingPrefs>(
  prefs: {
    getState: () => EditingPrefs;
    subscribe: (listener: () => void) => () => void;
  },
  target: {
    getState: () => T;
    setState: (updater: (draft: T) => void) => void;
  }
): () => void {
  const copy = () => {
    const source = prefs.getState();
    const current = target.getState();
    if (EDITING_PREF_KEYS.every(key => current[key] === source[key])) return;
    target.setState(draft => {
      for (const key of EDITING_PREF_KEYS) {
        (draft as Record<string, unknown>)[key] = source[key];
      }
    });
  };
  copy();
  return prefs.subscribe(copy);
}

/**
 * The colour scheme to draw in, from the one a reader asked for.
 *
 * Both apps resolve `system` against the device, and both draw the canvas in
 * a scheme the CSS or native theme cannot tell it — VexFlow paints literal
 * colours — so the answer has to be one value that every surface reads. The
 * web resolved it inside `app/theme.ts` with the media query baked in; the
 * question of *how* to ask the device is the host's, the rule for what the
 * answer means is this.
 */
export function resolveThemeMode(
  mode: ThemeMode,
  systemIsDark: boolean
): ResolvedThemeMode {
  if (mode === 'system') return systemIsDark ? 'dark' : 'light';
  return mode;
}
