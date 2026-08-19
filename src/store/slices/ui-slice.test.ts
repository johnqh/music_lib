import { describe, expect, it } from 'vitest';
import { testStoreContext } from '../../test/store-context.js';
import { createAppStore } from '../useAppStore.js';

describe('ui-slice', () => {
  it('defaults to no explicit active track, system theme, zoom 1, quarter-note snap, developer mode off', () => {
    const store = createAppStore({ context: testStoreContext() });
    const state = store.getState();
    expect(state.activeTrackId).toBeNull();
    expect(state.visibleTrackIds).toBeNull();
    expect(state.editMode).toBe('replace');
    expect(state.themeMode).toBe('system');
    expect(state.zoom).toBe(1);
    expect(state.snapGrid).toBe('quarter');
    expect(state.developerMode).toBe(false);
    expect(state.toasts).toEqual([]);
    expect(state.dialogs).toEqual({});
  });

  it('simple setters write their own field', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setActiveTrack('track-1');
    expect(store.getState().activeTrackId).toBe('track-1');
    store.getState().setThemeMode('dark');
    expect(store.getState().themeMode).toBe('dark');
    store.getState().setZoom(2);
    expect(store.getState().zoom).toBe(2);
    store.getState().setSnapGrid('eighth');
    expect(store.getState().snapGrid).toBe('eighth');
    store.getState().setDeveloperMode(true);
    expect(store.getState().developerMode).toBe(true);
  });

  describe('visible tracks', () => {
    it('setVisibleTracks stores the list and marks the project dirty', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setVisibleTracks(['a', 'b']);
      expect(store.getState().visibleTrackIds).toEqual(['a', 'b']);
      expect(store.getState().dirty).toBe(true);
    });

    it('setVisibleTracks refuses an empty list', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setVisibleTracks(['a']);
      store.getState().setVisibleTracks([]);
      expect(store.getState().visibleTrackIds).toEqual(['a']);
    });

    it('setActiveTrack reveals a hidden track', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setVisibleTracks(['a']);
      store.getState().setActiveTrack('b');
      expect(store.getState().visibleTrackIds).toEqual(['a', 'b']);
    });

    it('setActiveTrack leaves visibility alone when nothing is hidden', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setActiveTrack('b');
      expect(store.getState().visibleTrackIds).toBeNull();
    });

    it('setActiveTrack on an already-visible track does not mark dirty', () => {
      // Only a change worth persisting should trigger a save; moving the
      // caret's track around must not queue writes.
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setVisibleTracks(['a', 'b']);
      store.getState().saveNow();
      const before = store.getState().dirty;
      store.getState().setActiveTrack('b');
      expect(store.getState().dirty).toBe(before);
    });
  });

  describe('setDevSettings', () => {
    it('merges the patch into devSettings', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setDevSettings({ showIds: true });
      expect(store.getState().devSettings.showIds).toBe(true);
      expect(store.getState().devSettings.showTicks).toBe(false); // untouched
    });
  });

  describe('dialogs', () => {
    it('openDialog/closeDialog/toggleDialog track per-id open state', () => {
      const store = createAppStore({ context: testStoreContext() });
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
      const store = createAppStore({ context: testStoreContext() });
      const id = store.getState().pushToast({ message: 'Saved' });
      expect(store.getState().toasts).toHaveLength(1);
      expect(store.getState().toasts[0]).toEqual({
        id,
        message: 'Saved',
        severity: 'info',
      });

      store.getState().dismissToast(id);
      expect(store.getState().toasts).toEqual([]);
    });

    it('pushToast defaults severity to "info" but honors an explicit one', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().pushToast({ message: 'Uh oh', severity: 'error' });
      expect(store.getState().toasts[0].severity).toBe('error');
    });
  });
});

describe('activeTrackId', () => {
  it('setActiveTrack(null) clears an explicit choice', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setActiveTrack('track-1');
    store.getState().setActiveTrack(null);
    expect(store.getState().activeTrackId).toBeNull();
  });

  describe('edit mode', () => {
    it('defaults to replace, which is what the editor already did', () => {
      const store = createAppStore({ context: testStoreContext() });
      expect(store.getState().editMode).toBe('replace');
    });

    it('sets each mode', () => {
      const store = createAppStore({ context: testStoreContext() });
      for (const mode of ['insert', 'stack', 'replace'] as const) {
        store.getState().setEditMode(mode);
        expect(store.getState().editMode).toBe(mode);
      }
    });

    it('does not mark the project dirty', () => {
      // A mode is how you are editing, not part of the music. Persisting it
      // would queue a save on every toggle.
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setEditMode('insert');
      expect(store.getState().dirty).toBe(false);
    });
  });
});

describe('active voice', () => {
  it('defaults to the first voice', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(store.getState().activeVoiceIndex).toBe(0);
  });

  it('sets the voice', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setActiveVoice(1);
    expect(store.getState().activeVoiceIndex).toBe(1);
  });

  it('clamps a negative index rather than writing into a voice that is not one', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setActiveVoice(-3);
    expect(store.getState().activeVoiceIndex).toBe(0);
  });
});

describe('pitchDisplay', () => {
  it('starts in concert pitch and toggles to written', () => {
    // Concert by default: nothing changes for anyone who does not ask.
    const store = createAppStore({ context: testStoreContext() });
    expect(store.getState().pitchDisplay).toBe('concert');
    store.getState().setPitchDisplay('written');
    expect(store.getState().pitchDisplay).toBe('written');
  });
});
