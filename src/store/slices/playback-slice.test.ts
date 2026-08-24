import { describe, expect, it } from 'vitest';
import { testStoreContext } from '../../test/store-context.js';
import { createAppStore } from '../useAppStore.js';

describe('playback-slice', () => {
  it('starts stopped, with no active notes/loop, unit tempo, metronome off, full volume', () => {
    // No caret here any more: the position is one shared value, not a store
    // field this slice has to initialise and keep in step.
    const store = createAppStore({ context: testStoreContext() });
    const state = store.getState();
    expect(state.state).toBe('stopped');
    expect(state.loopRange).toBeNull();
    expect(state.tempoMultiplier).toBe(1);
    expect(state.metronome).toBe(false);
    expect(state.masterVolume).toBe(1);
  });

  it('every setter writes exactly its own field', () => {
    const store = createAppStore({ context: testStoreContext() });

    store.getState().setPlaybackState('playing');
    expect(store.getState().state).toBe('playing');

    const loop = { startTick: 0, endTick: 1920, trackIds: ['t1'] };
    store.getState().setLoopRange(loop);
    expect(store.getState().loopRange).toEqual(loop);
    store.getState().setLoopRange(null);
    expect(store.getState().loopRange).toBeNull();

    store.getState().setTempoMultiplier(1.5);
    expect(store.getState().tempoMultiplier).toBe(1.5);

    store.getState().setMetronome(true);
    expect(store.getState().metronome).toBe(true);

    store.getState().setMasterVolume(0.5);
    expect(store.getState().masterVolume).toBe(0.5);
  });
});
