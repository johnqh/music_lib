/**
 * Device prefs: how this person likes to work, on this device.
 *
 * Read defensively — a stored value comes from whatever build wrote it, or from
 * a hand edit — and written without losing what an older or newer build keeps
 * beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindDevicePrefs,
  createDevicePrefsStore,
  DEFAULT_DEV_SETTINGS,
  DEFAULT_DEVICE_PREFS,
  LEGACY_FONT_SIZE_KEY,
  LEGACY_THEME_MODE_KEY,
  loadPrefs,
  mirrorDevicePrefs,
  parseDevicePrefs,
  PREFS_KEY,
  savePrefs,
} from './prefs.js';
import { MemoryPrefsStorage, testStoreContext } from '../test/store-context.js';
import { createAppStore } from '../store/useAppStore.js';
import { createDocumentStore } from '../store/document-store.js';
import { twinkleScore } from '../test/fixtures.js';

describe('parseDevicePrefs', () => {
  it('fills every missing field with its default', () => {
    expect(parseDevicePrefs(undefined)).toEqual(DEFAULT_DEVICE_PREFS);
    expect(parseDevicePrefs({})).toEqual(DEFAULT_DEVICE_PREFS);
  });

  it('starts with the keyboard expanded', () => {
    expect(DEFAULT_DEVICE_PREFS.keyboardCollapsed).toBe(false);
  });

  it('keeps valid values and replaces invalid ones field by field', () => {
    expect(
      parseDevicePrefs({
        themeMode: 'dark',
        developerMode: 'yes',
        pitchDisplay: 'written',
        keyboardCollapsed: true,
        fontSize: 'enormous',
        language: 'zh-Hans',
      })
    ).toEqual({
      ...DEFAULT_DEVICE_PREFS,
      themeMode: 'dark',
      pitchDisplay: 'written',
      keyboardCollapsed: true,
      language: 'zh-Hans',
    });
  });

  it('ignores keys nothing reads any more, including a stale devSettings', () => {
    /*
      A stored object was written by whatever build wrote it. Six developer
      toggles were removed once nothing was found to read them, and a build
      that persisted a `devSettings` block (or any other field since dropped)
      must not make this throw, and must not resurrect the setting. The answer
      is built field by field, which is what makes that true by construction.
    */
    expect(
      parseDevicePrefs({
        themeMode: 'dark',
        devSettings: {
          showIds: true,
          showTicks: true,
          showMeasureBoundaries: true,
          showPlaybackScheduling: true,
          enableDiagnostics: true,
          enableValidationWarnings: false,
        },
        view: 'piano-roll',
        zoom: 3,
      })
    ).toEqual({ ...DEFAULT_DEVICE_PREFS, themeMode: 'dark' });
  });

  it('refuses a language that is not a language tag', () => {
    expect(parseDevicePrefs({ language: '' }).language).toBeNull();
    expect(parseDevicePrefs({ language: '../../etc' }).language).toBeNull();
    expect(parseDevicePrefs({ language: 42 }).language).toBeNull();
  });
});

describe('loadPrefs', () => {
  it('reads what the web app has stored under the v1 key', async () => {
    const storage = new MemoryPrefsStorage();
    storage.setItem(
      PREFS_KEY,
      JSON.stringify({
        themeMode: 'light',
        developerMode: true,
        pitchDisplay: 'written',
        // Fields an older build wrote, and nothing reads any more.
        view: 'notation',
        zoom: 1.25,
      })
    );
    expect(await loadPrefs(storage)).toEqual({
      ...DEFAULT_DEVICE_PREFS,
      themeMode: 'light',
      developerMode: true,
      pitchDisplay: 'written',
    });
  });

  it("falls back to the native app's old theme key", async () => {
    const storage = new MemoryPrefsStorage();
    await storage.setItem(LEGACY_THEME_MODE_KEY, 'dark');
    expect((await loadPrefs(storage)).themeMode).toBe('dark');
    // A theme in the prefs object wins over the old key.
    await storage.setItem(PREFS_KEY, JSON.stringify({ themeMode: 'light' }));
    expect((await loadPrefs(storage)).themeMode).toBe('light');
  });

  it("falls back to the web app's old font-size key", async () => {
    const storage = new MemoryPrefsStorage();
    storage.setItem(LEGACY_FONT_SIZE_KEY, 'large');
    expect((await loadPrefs(storage)).fontSize).toBe('large');

    storage.setItem(PREFS_KEY, JSON.stringify({ fontSize: 'small' }));
    expect((await loadPrefs(storage)).fontSize).toBe('small');
  });

  it('answers the defaults for unreadable storage rather than throwing', async () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
    };
    expect(await loadPrefs(broken)).toEqual(DEFAULT_DEVICE_PREFS);

    const storage = new MemoryPrefsStorage();
    storage.setItem(PREFS_KEY, '{not json');
    expect(await loadPrefs(storage)).toEqual(DEFAULT_DEVICE_PREFS);
  });
});

describe('savePrefs', () => {
  it('merges into what is stored, keeping fields it does not know', async () => {
    const storage = new MemoryPrefsStorage();
    storage.setItem(
      PREFS_KEY,
      JSON.stringify({ zoom: 2, themeMode: 'dark', fontSize: 'large' })
    );
    await savePrefs(storage, { themeMode: 'light' });
    expect(JSON.parse(storage.getItem(PREFS_KEY)!)).toEqual({
      zoom: 2,
      themeMode: 'light',
      fontSize: 'large',
    });
  });

  it('never throws over a storage failure', async () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    await expect(savePrefs(broken, { themeMode: 'dark' })).resolves.toBe(
      undefined
    );
  });
});

describe('bindDevicePrefs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads into the store, then persists every change', async () => {
    const storage = new MemoryPrefsStorage();
    storage.setItem(
      PREFS_KEY,
      JSON.stringify({ themeMode: 'dark', keyboardCollapsed: true })
    );
    const store = createDevicePrefsStore();
    const binding = bindDevicePrefs(store, storage);
    await binding.ready;

    expect(store.getState().themeMode).toBe('dark');
    expect(store.getState().keyboardCollapsed).toBe(true);

    store.getState().setKeyboardCollapsed(false);
    store.getState().setLanguage('zh');
    await vi.runAllTimersAsync();

    const stored = JSON.parse(storage.getItem(PREFS_KEY)!);
    expect(stored.keyboardCollapsed).toBe(false);
    expect(stored.language).toBe('zh');
    expect(stored.themeMode).toBe('dark');
    binding.unbind();
  });

  it('leaves the developer settings alone, whatever storage holds', async () => {
    /*
      `devSettings` is not a persisted pref and must not become one by accident:
      a stored block naming settings that no longer exist has to reach the store
      as nothing at all, or a removed toggle comes back as a key on the object.
    */
    const storage = new MemoryPrefsStorage();
    storage.setItem(
      PREFS_KEY,
      JSON.stringify({ devSettings: { showIds: true, generationVariant: 'x' } })
    );
    const store = createDevicePrefsStore();
    const binding = bindDevicePrefs(store, storage);
    await binding.ready;
    expect(store.getState().devSettings).toEqual(DEFAULT_DEV_SETTINGS);
    binding.unbind();
  });

  it('does not write the defaults over stored prefs before they have loaded', async () => {
    const storage = new MemoryPrefsStorage();
    storage.setItem(PREFS_KEY, JSON.stringify({ themeMode: 'dark' }));
    const setItem = vi.spyOn(storage, 'setItem');
    const store = createDevicePrefsStore();
    const binding = bindDevicePrefs(store, storage);
    await binding.ready;
    await vi.runAllTimersAsync();
    expect(setItem).not.toHaveBeenCalled();
    binding.unbind();
  });

  it('stops persisting once unbound', async () => {
    const storage = new MemoryPrefsStorage();
    const store = createDevicePrefsStore();
    const binding = bindDevicePrefs(store, storage);
    await binding.ready;
    binding.unbind();
    store.getState().setFontSize('large');
    await vi.runAllTimersAsync();
    expect(storage.getItem(PREFS_KEY)).toBeNull();
  });

  it("binds the web app's store, whose ui slice already holds three of them", async () => {
    const storage = new MemoryPrefsStorage();
    storage.setItem(PREFS_KEY, JSON.stringify({ pitchDisplay: 'written' }));
    const store = createAppStore({ context: testStoreContext() });
    const binding = bindDevicePrefs(store, storage);
    await binding.ready;
    expect(store.getState().pitchDisplay).toBe('written');
    expect(store.getState().keyboardCollapsed).toBe(false);

    store.getState().setThemeMode('light');
    store.getState().setKeyboardCollapsed(true);
    await vi.runAllTimersAsync();
    const stored = JSON.parse(storage.getItem(PREFS_KEY)!);
    expect(stored.themeMode).toBe('light');
    expect(stored.keyboardCollapsed).toBe(true);
    binding.unbind();
  });

  it('ignores edits that are not prefs', async () => {
    const storage = new MemoryPrefsStorage();
    const store = createAppStore({ context: testStoreContext() });
    const binding = bindDevicePrefs(store, storage);
    await binding.ready;
    const setItem = vi.spyOn(storage, 'setItem');
    store.getState().setZoom(2);
    await vi.runAllTimersAsync();
    expect(setItem).not.toHaveBeenCalled();
    binding.unbind();
  });
});

/*
  The theme, developer mode and developer settings moved here from music_editing's
  ui slice; these are the assertions that slice's tests used to make, against
  both stores that compose the prefs slice.
*/
describe('the device prefs slice', () => {
  const stores = {
    'the app store': () => createAppStore({ context: testStoreContext() }),
    'the device prefs store': () => createDevicePrefsStore(),
  };

  for (const [name, make] of Object.entries(stores)) {
    describe(name, () => {
      it('defaults to the system theme with developer mode off', () => {
        const state = make().getState();
        expect(state.themeMode).toBe('system');
        expect(state.developerMode).toBe(false);
        expect(state.devSettings).toEqual(DEFAULT_DEV_SETTINGS);
      });

      it('keeps only settings something reads', () => {
        /*
          Six overlay toggles lived here and were read by nothing in any
          package, while both apps drew a switch for each. A setting nobody
          reads is a control that appears broken, so the rule is now that a
          field has to have a reader — and this fails if one is added back
          without the rest of this test being thought about.
        */
        const state = make().getState();
        expect(Object.keys(state.devSettings)).toEqual(['generationVariant']);
      });

      it('sets the theme and developer mode', () => {
        const store = make();
        store.getState().setThemeMode('dark');
        store.getState().setDeveloperMode(true);
        expect(store.getState().themeMode).toBe('dark');
        expect(store.getState().developerMode).toBe(true);
      });

      it('merges a patch into devSettings', () => {
        const store = make();
        store.getState().setDevSettings({ generationVariant: 'local' });
        expect(store.getState().devSettings.generationVariant).toBe('local');
      });
    });
  }

  it('gives each store its own developer settings', () => {
    // Spread from the defaults, not shared: a patch in one store must not
    // reach another, nor the defaults every later store starts from.
    const first = createDevicePrefsStore();
    first.getState().setDevSettings({ generationVariant: 'local' });
    expect(
      createDevicePrefsStore().getState().devSettings.generationVariant
    ).toBe(DEFAULT_DEV_SETTINGS.generationVariant);
  });
});

describe('mirrorDevicePrefs', () => {
  it('copies the editing prefs into a document store, now and on every change', () => {
    const prefs = createDevicePrefsStore();
    prefs.getState().setPitchDisplay('written');
    const doc = createDocumentStore({ score: twinkleScore(), title: 'T' });

    const stop = mirrorDevicePrefs(prefs, doc);
    expect(doc.getState().pitchDisplay).toBe('written');

    // Prefs editing does not read stay on the prefs store: the theme and
    // developer mode left the editing state along with the keyboard's.
    prefs.getState().setThemeMode('dark');
    prefs.getState().setDeveloperMode(true);
    prefs.getState().setKeyboardCollapsed(true);
    for (const key of ['themeMode', 'developerMode', 'keyboardCollapsed'])
      expect(key in doc.getState(), key).toBe(false);

    stop();
    prefs.getState().setPitchDisplay('concert');
    expect(doc.getState().pitchDisplay).toBe('written');
  });

  it('does not mark the document dirty: a device setting is not an edit', () => {
    const prefs = createDevicePrefsStore();
    const doc = createDocumentStore({ score: twinkleScore(), title: 'T' });
    mirrorDevicePrefs(prefs, doc);
    prefs.getState().setPitchDisplay('written');
    expect(doc.getState().dirty).toBe(false);
  });
});
