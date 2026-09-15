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

describe('mirrorDevicePrefs', () => {
  it('copies the editing prefs into a document store, now and on every change', () => {
    const prefs = createDevicePrefsStore();
    prefs.getState().setPitchDisplay('written');
    const doc = createDocumentStore({ score: twinkleScore(), title: 'T' });

    const stop = mirrorDevicePrefs(prefs, doc);
    expect(doc.getState().pitchDisplay).toBe('written');

    prefs.getState().setThemeMode('dark');
    prefs.getState().setDeveloperMode(true);
    expect(doc.getState().themeMode).toBe('dark');
    expect(doc.getState().developerMode).toBe(true);
    // A pref editing does not read stays on the prefs store.
    prefs.getState().setKeyboardCollapsed(true);
    expect('keyboardCollapsed' in doc.getState()).toBe(false);

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
