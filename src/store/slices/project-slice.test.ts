/**
 * project-slice behavior against the in-memory FakeMusicClient (server-side
 * persistence, Phase 2): create/open/rename, autosave debounce + manual
 * flush, flush-before-switch (no lost edits), and save-failure surfacing.
 * Timers are faked; Date stays real (no fake-indexeddb constraints anymore).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addMeasureCommand } from '../../domain/commands/structure-commands.js';
import { testStoreContext } from '../../test/store-context.js';
import { createAppStore } from '../useAppStore.js';

const AUTOSAVE_MS = 2000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('project-slice (server-backed)', () => {
  it('newProject creates on the server and adopts the record', async () => {
    const context = testStoreContext();
    const store = createAppStore({ context });
    await store.getState().newProject({ name: 'My Song' });
    const state = store.getState();
    expect(state.projectId).toBe('proj-1');
    expect(state.projectName).toBe('My Song');
    expect(state.dirty).toBe(false);
    expect(state.saveState).toBe('saved');
    expect(state.score?.metadata.title).toBe('My Song');
    expect(context.fakeClient.storedRecord('proj-1')).toBeDefined();
  });

  it('openProject loads the record and resets history', async () => {
    const context = testStoreContext();
    const store = createAppStore({ context });
    await store.getState().newProject({ name: 'A' });
    const id = store.getState().projectId!;
    const other = createAppStore({ context });
    await other.getState().openProject(id);
    expect(other.getState().projectName).toBe('A');
    expect(other.getState().canUndo).toBe(false);
  });

  it('markDirty schedules a debounced autosave that PUTs the current score', async () => {
    const context = testStoreContext();
    const store = createAppStore({ context });
    await store.getState().newProject({ name: 'B' });
    const before = context.fakeClient.updateCalls;

    store.getState().dispatchCommand(addMeasureCommand());
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().saveState).toBe('unsaved');
    expect(context.fakeClient.updateCalls).toBe(before); // debounced, not yet

    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 50);
    expect(context.fakeClient.updateCalls).toBe(before + 1);
    expect(store.getState().saveState).toBe('saved');
    expect(store.getState().dirty).toBe(false);
    const stored = context.fakeClient.storedRecord(store.getState().projectId!)!;
    expect(stored.score.tracks[0].measures.length).toBe(
      store.getState().score!.tracks[0].measures.length
    );
  });

  it('saveNow flushes a pending debounced save immediately', async () => {
    const context = testStoreContext();
    const store = createAppStore({ context });
    await store.getState().newProject({ name: 'C' });
    store.getState().dispatchCommand(addMeasureCommand());
    const before = context.fakeClient.updateCalls;
    await store.getState().saveNow();
    expect(context.fakeClient.updateCalls).toBe(before + 1);
    expect(store.getState().saveState).toBe('saved');
  });

  it('switching projects flushes the outgoing pending autosave first (no lost edits)', async () => {
    const context = testStoreContext();
    const store = createAppStore({ context });
    await store.getState().newProject({ name: 'First' });
    const firstId = store.getState().projectId!;
    const measuresBefore = store.getState().score!.tracks[0].measures.length;

    store.getState().dispatchCommand(addMeasureCommand());
    // switch immediately, within the debounce window
    await store.getState().newProject({ name: 'Second' });

    const persistedFirst = context.fakeClient.storedRecord(firstId)!;
    expect(persistedFirst.score.tracks[0].measures.length).toBe(measuresBefore + 1);
    expect(store.getState().projectName).toBe('Second');
  });

  it('renameProject persists the new name on the next flush', async () => {
    const context = testStoreContext();
    const store = createAppStore({ context });
    await store.getState().newProject({ name: 'Old Name' });
    store.getState().renameProject('New Name');
    expect(store.getState().projectName).toBe('New Name');
    await store.getState().saveNow();
    expect(context.fakeClient.storedRecord(store.getState().projectId!)!.name).toBe('New Name');
  });

  it('a failed server save keeps the project unsaved and pushes an error toast', async () => {
    const context = testStoreContext();
    const store = createAppStore({ context });
    await store.getState().newProject({ name: 'D' });
    context.fakeClient.failNextSaves = 1;
    store.getState().dispatchCommand(addMeasureCommand());
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 50).catch(() => undefined);
    expect(store.getState().saveState).toBe('unsaved');
    expect(store.getState().toasts.some((t) => t.severity === 'error')).toBe(true);
    // a later change + manual save retries and succeeds
    store.getState().markDirty();
    await store.getState().saveNow();
    expect(store.getState().saveState).toBe('saved');
  });

  it('markDirty without an open project is a safe no-op for the autosaver', async () => {
    const context = testStoreContext();
    const store = createAppStore({ context });
    store.getState().markDirty();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 50);
    expect(context.fakeClient.updateCalls).toBe(0);
  });
});
