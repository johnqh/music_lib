import { describe, expect, it } from 'vitest';
import { createAppStore } from '../useAppStore.js';

describe('playback-slice', () => {
  it('starts stopped, at tick 0, with no active notes/loop, unit tempo, metronome off, full volume', () => {
    const store = createAppStore();
    const state = store.getState();
    expect(state.state).toBe('stopped');
    expect(state.positionTick).toBe(0);
    expect(state.activeNoteIds).toEqual([]);
    expect(state.loopRange).toBeNull();
    expect(state.tempoMultiplier).toBe(1);
    expect(state.metronome).toBe(false);
    expect(state.masterVolume).toBe(1);
  });

  it('every setter writes exactly its own field', () => {
    const store = createAppStore();

    store.getState().setPlaybackState('playing');
    expect(store.getState().state).toBe('playing');

    store.getState().setPositionTick(1920);
    expect(store.getState().positionTick).toBe(1920);

    store.getState().setActiveNoteIds(['n1', 'n2']);
    expect(store.getState().activeNoteIds).toEqual(['n1', 'n2']);

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
