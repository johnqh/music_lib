import { afterEach, describe, expect, it } from 'vitest';
import { createAppStore } from '../useAppStore';
import { getProvider, resetProvider } from '../../services/generation/registry';

afterEach(() => {
  resetProvider();
});

describe('ui-slice', () => {
  it('defaults to notation view, system theme, zoom 1, quarter-note snap, developer mode off', () => {
    const store = createAppStore();
    const state = store.getState();
    expect(state.view).toBe('notation');
    expect(state.themeMode).toBe('system');
    expect(state.zoom).toBe(1);
    expect(state.snapGrid).toBe('quarter');
    expect(state.developerMode).toBe(false);
    expect(state.toasts).toEqual([]);
    expect(state.dialogs).toEqual({});
  });

  it('simple setters write their own field', () => {
    const store = createAppStore();
    store.getState().setView('piano-roll');
    expect(store.getState().view).toBe('piano-roll');
    store.getState().setThemeMode('dark');
    expect(store.getState().themeMode).toBe('dark');
    store.getState().setZoom(2);
    expect(store.getState().zoom).toBe(2);
    store.getState().setSnapGrid('eighth');
    expect(store.getState().snapGrid).toBe('eighth');
    store.getState().setDeveloperMode(true);
    expect(store.getState().developerMode).toBe(true);
  });

  describe('setDevSettings', () => {
    it('merges the patch into devSettings', () => {
      const store = createAppStore();
      store.getState().setDevSettings({ showIds: true });
      expect(store.getState().devSettings.showIds).toBe(true);
      expect(store.getState().devSettings.showTicks).toBe(false); // untouched
    });

    it('changing the seed re-seeds the generation provider registry', () => {
      const store = createAppStore();
      store.getState().setDevSettings({ seed: 'ui-slice-test-seed' });
      expect(store.getState().devSettings.seed).toBe('ui-slice-test-seed');
      expect(getProvider().id).toBe('mock');
    });
  });

  describe('dialogs', () => {
    it('openDialog/closeDialog/toggleDialog track per-id open state', () => {
      const store = createAppStore();
      store.getState().openDialog('newProject');
      expect(store.getState().dialogs.newProject).toBe(true);

      store.getState().closeDialog('newProject');
      expect(store.getState().dialogs.newProject).toBe(false);

      store.getState().toggleDialog('midiImport');
      expect(store.getState().dialogs.midiImport).toBe(true);
      store.getState().toggleDialog('midiImport');
      expect(store.getState().dialogs.midiImport).toBe(false);
    });
  });

  describe('toasts', () => {
    it('pushToast enqueues a toast and returns its id; dismissToast removes it', () => {
      const store = createAppStore();
      const id = store.getState().pushToast({ message: 'Saved' });
      expect(store.getState().toasts).toHaveLength(1);
      expect(store.getState().toasts[0]).toEqual({ id, message: 'Saved', severity: 'info' });

      store.getState().dismissToast(id);
      expect(store.getState().toasts).toEqual([]);
    });

    it('pushToast defaults severity to "info" but honors an explicit one', () => {
      const store = createAppStore();
      store.getState().pushToast({ message: 'Uh oh', severity: 'error' });
      expect(store.getState().toasts[0].severity).toBe('error');
    });
  });
});
