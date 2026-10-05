/**
 * The track-info pref is read defensively and written like the rest.
 */
import { describe, expect, it } from 'vitest';
import { TRACK_INFO_MODES } from '@sudobility/music_types';
import type { PrefsStorage } from '@sudobility/music_types';
import {
  DEFAULT_DEVICE_PREFS,
  DEVICE_PREF_KEYS,
  PREFS_KEY,
  bindDevicePrefs,
  createDevicePrefsStore,
  parseDevicePrefs,
} from './prefs';

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage = {
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: async (key: string) => {
      items.delete(key);
    },
  } as unknown as PrefsStorage;
  return { items, storage };
}

describe('the track info pref', () => {
  it('shows the full column until somebody says otherwise', () => {
    expect(DEFAULT_DEVICE_PREFS.trackInfo).toBe('full');
    expect(parseDevicePrefs({}).trackInfo).toBe('full');
  });

  it.each(TRACK_INFO_MODES)('reads a stored %s back', mode => {
    expect(parseDevicePrefs({ trackInfo: mode }).trackInfo).toBe(mode);
  });

  it('falls back alone when what is stored is not a mode', () => {
    const prefs = parseDevicePrefs({ trackInfo: 'tiny', themeMode: 'dark' });
    expect(prefs.trackInfo).toBe('full');
    // The field beside it is untouched by its neighbour being unusable.
    expect(prefs.themeMode).toBe('dark');
  });

  it('is one of the prefs a binding persists', () => {
    expect(DEVICE_PREF_KEYS).toContain('trackInfo');
  });

  it('remembers the generation provider in device preferences', () => {
    expect(DEFAULT_DEVICE_PREFS.generationVariant).toBe('deepseek');
    expect(
      parseDevicePrefs({ generationVariant: 'claude' }).generationVariant
    ).toBe('claude');
    expect(
      parseDevicePrefs({ generationVariant: 'unknown' }).generationVariant
    ).toBe('deepseek');
    expect(DEVICE_PREF_KEYS).toContain('generationVariant');
  });

  it('is loaded into the store and written back when it changes', async () => {
    const { items, storage } = memory({
      [PREFS_KEY]: JSON.stringify({ trackInfo: 'icon' }),
    });
    const store = createDevicePrefsStore();
    const binding = bindDevicePrefs(store, storage);
    await binding.ready;
    expect(store.getState().trackInfo).toBe('icon');

    store.getState().setTrackInfo('hidden');
    store.getState().setGenerationVariant('claude');
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(JSON.parse(items.get(PREFS_KEY) ?? '{}').trackInfo).toBe('hidden');
    expect(JSON.parse(items.get(PREFS_KEY) ?? '{}').generationVariant).toBe(
      'claude'
    );
    binding.unbind();

    const restoredStore = createDevicePrefsStore();
    const restoredBinding = bindDevicePrefs(restoredStore, storage);
    await restoredBinding.ready;
    expect(restoredStore.getState().generationVariant).toBe('claude');
    restoredBinding.unbind();
  });
});

describe('the paper size pref', () => {
  it('follows the device until somebody chooses', () => {
    expect(DEFAULT_DEVICE_PREFS.paperSize).toBeNull();
    expect(parseDevicePrefs({}).paperSize).toBeNull();
  });

  it('reads a stored paper back, and drops one it does not know', () => {
    expect(parseDevicePrefs({ paperSize: 'letter' }).paperSize).toBe('letter');
    expect(parseDevicePrefs({ paperSize: 'A3' }).paperSize).toBeNull();
  });

  it('is written back when it changes', async () => {
    const { items, storage } = memory();
    const store = createDevicePrefsStore();
    const binding = bindDevicePrefs(store, storage);
    await binding.ready;

    store.getState().setPaperSize('legal');
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(JSON.parse(items.get(PREFS_KEY) ?? '{}').paperSize).toBe('legal');
    binding.unbind();
  });
});
