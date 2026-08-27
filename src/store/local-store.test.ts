/**
 * A store with no server behind it.
 *
 * The native app edits a local file with nobody signed in, so `StoreContext`
 * has to be constructible without a `MusicClient` — and everything that does
 * not need one has to keep working. A local document is not a degraded
 * project: editing, undo and the dirty flag are all fully present, and only
 * the genuinely server-backed features report themselves unavailable.
 */
import { describe, expect, it } from 'vitest';
import { createAppStore } from './useAppStore.js';
import { hasServer, ServerUnavailableError } from './context.js';
import { localStoreContext, testStoreContext } from '../test/store-context.js';
import { twinkleScore } from '../test/fixtures.js';
import { changeMetadataCommand } from '@sudobility/music_types';

describe('a store with no server', () => {
  it('reports itself server-less', () => {
    const context = localStoreContext();
    expect(hasServer(context)).toBe(false);
    const store = createAppStore({ context });
    expect(store.getState().serverAvailable).toBe(false);
  });

  it('still edits, tracks dirt and undoes', () => {
    const store = createAppStore({ context: localStoreContext() });
    store.getState().setScore(twinkleScore(), { resetHistory: true });
    expect(store.getState().dirty).toBe(false);

    store
      .getState()
      .dispatchCommand(changeMetadataCommand({ title: 'Local' }, 'Set title'));
    expect(store.getState().score?.metadata.title).toBe('Local');
    expect(store.getState().dirty).toBe(true);

    store.getState().undo();
    expect(store.getState().score?.metadata.title).not.toBe('Local');
  });

  it('refuses the server-backed project actions by name', async () => {
    const store = createAppStore({ context: localStoreContext() });
    await expect(store.getState().newProject({ name: 'x' })).rejects.toThrow(
      ServerUnavailableError
    );
    await expect(store.getState().openProject('p1')).rejects.toThrow(
      ServerUnavailableError
    );
  });

  it('leaves saveNow a silent no-op rather than an error', async () => {
    const store = createAppStore({ context: localStoreContext() });
    store.getState().setScore(twinkleScore(), { resetHistory: true });
    store.getState().markDirty();
    await expect(store.getState().saveNow()).resolves.toBeUndefined();
  });

  it('reports generation as unavailable instead of throwing', async () => {
    const store = createAppStore({ context: localStoreContext() });
    await store.getState().generate({
      prompt: 'anything',
      durationMeasures: 4,
      tracks: [
        {
          name: 'Piano',
          instrumentName: 'Piano',
          midiProgram: 0,
          clef: 'treble',
        },
      ],
    });
    expect(store.getState().pending).toBe(false);
    expect(store.getState().error).not.toBeNull();
  });
});

describe('a store with a server', () => {
  it('still reports itself available', () => {
    const context = testStoreContext();
    expect(hasServer(context)).toBe(true);
    expect(createAppStore({ context }).getState().serverAvailable).toBe(true);
  });
});
