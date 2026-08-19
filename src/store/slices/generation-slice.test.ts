import { afterEach, describe, expect, it } from 'vitest';
import { createAppStore } from '../useAppStore.js';
import {
  testStoreContext,
  FakeGenerationProvider,
} from '../../test/store-context.js';

// Late-binding provider shim replacing the deleted process-wide registry:
// `setProvider()` swaps what the delegator forwards to, even after a store
// is created (several tests inject a stub after seeding a selection).
let injectedProvider: MusicGenerationProvider | undefined;
function setProvider(p: MusicGenerationProvider): void {
  injectedProvider = p;
}
function resetProvider(): void {
  injectedProvider = undefined;
}
const defaultFake = new FakeGenerationProvider();
const delegatingProvider: MusicGenerationProvider = {
  id: 'delegator',
  name: 'Delegator',
  generateScore: (req, signal) =>
    (injectedProvider ?? defaultFake).generateScore(req, signal),
  regenerateRegion: (req, signal) =>
    (injectedProvider ?? defaultFake).regenerateRegion(req, signal),
};
import { twinkleScore } from '../../test/fixtures.js';
import { allNotes } from '../../domain/score/queries.js';
import type {
  GenerateScoreRequest,
  GenerateScoreResult,
  MusicGenerationProvider,
  RegenerateRegionRequest,
  RegenerateRegionResult,
} from '@sudobility/music_types';

const REQUEST: GenerateScoreRequest = {
  prompt: 'Create a gentle eight-measure piano piece in A minor',
  durationMeasures: 4,
  tracks: [
    { name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' },
  ],
};

afterEach(() => {
  resetProvider();
});

/**
 * A `MusicGenerationProvider` whose calls stay pending until the test
 * resolves/rejects them by hand (via `generateCalls`/`regenerateCalls`),
 * and which honors `AbortSignal` the same way a real network-backed
 * provider would (rejecting with an `AbortError` `DOMException` once the
 * signal fires) — for exercising generation-slice's request-supersession
 * behavior (finding 2) under manual control.
 */
class ControllableProvider implements MusicGenerationProvider {
  readonly id = 'controllable';
  readonly name = 'Controllable Test Provider';
  readonly generateCalls: Array<{
    request: GenerateScoreRequest;
    resolve: (result: GenerateScoreResult) => void;
    reject: (error: unknown) => void;
  }> = [];
  readonly regenerateCalls: Array<{
    request: RegenerateRegionRequest;
    resolve: (result: RegenerateRegionResult) => void;
    reject: (error: unknown) => void;
  }> = [];

  generateScore(
    request: GenerateScoreRequest,
    signal?: AbortSignal
  ): Promise<GenerateScoreResult> {
    return new Promise((resolve, reject) => {
      this.generateCalls.push({ request, resolve, reject });
      signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      );
    });
  }

  regenerateRegion(
    request: RegenerateRegionRequest,
    signal?: AbortSignal
  ): Promise<RegenerateRegionResult> {
    return new Promise((resolve, reject) => {
      this.regenerateCalls.push({ request, resolve, reject });
      signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      );
    });
  }
}

describe('generation-slice', () => {
  describe('syncModeFromSelection (finding 4)', () => {
    it('derives "regenerate" from a selection carrying content, and "generate" from an empty one', () => {
      const store = createAppStore({
        context: testStoreContext({ provider: delegatingProvider }),
      });
      expect(store.getState().mode).toBe('generate');

      store.getState().syncModeFromSelection({
        eventIds: ['a'],
        measureIds: [],
        trackIds: [],
      });
      expect(store.getState().mode).toBe('regenerate');

      store
        .getState()
        .syncModeFromSelection({ eventIds: [], measureIds: [], trackIds: [] });
      expect(store.getState().mode).toBe('generate');
    });

    it('is the only path that writes `mode`: selection-slice mutators call it rather than touching the field themselves', () => {
      const store = createAppStore({
        context: testStoreContext({ provider: delegatingProvider }),
      });
      // setSelection (and everything built on it -- toggleEvent,
      // selectMeasures, selectTrack, clearSelection) must still end up
      // deriving `mode` correctly, now that it's routed through this
      // action instead of being written inline by selection-slice.
      store
        .getState()
        .setSelection({ eventIds: [], measureIds: ['m1'], trackIds: [] });
      expect(store.getState().mode).toBe('regenerate');
      store.getState().clearSelection();
      expect(store.getState().mode).toBe('generate');
    });
  });

  describe('generate', () => {
    it('adopts the provider-generated score, resets history, and marks the project dirty', async () => {
      const store = createAppStore({
        context: testStoreContext({ provider: delegatingProvider }),
      });

      await store.getState().generate(REQUEST);

      const state = store.getState();
      expect(state.score).not.toBeNull();
      expect(state.score!.tracks).toHaveLength(1);
      expect(state.pending).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastRequest).toEqual(REQUEST);
      expect(state.canUndo).toBe(false); // fresh history, not an undoable edit
      expect(state.dirty).toBe(true);
    });

    it('sets pending while the request is in flight', async () => {
      const store = createAppStore({
        context: testStoreContext({ provider: delegatingProvider }),
      });
      const promise = store.getState().generate(REQUEST);
      expect(store.getState().pending).toBe(true);
      await promise;
      expect(store.getState().pending).toBe(false);
    });
  });

  describe('cancel', () => {
    it('aborts an in-flight generate() call and clears pending without setting an error', async () => {
      const provider = new ControllableProvider();
      setProvider(provider);
      const store = createAppStore({
        context: testStoreContext({ provider: delegatingProvider }),
      });

      const promise = store.getState().generate(REQUEST);
      expect(store.getState().pending).toBe(true);

      store.getState().cancel();
      await promise;

      const state = store.getState();
      expect(state.pending).toBe(false);
      expect(state.error).toBeNull();
      expect(state.score).toBeNull();
    });

    it('aborts an in-flight generate() call started from a selection, leaving no error', async () => {
      const provider = new ControllableProvider();
      setProvider(provider);
      const store = createAppStore({
        context: testStoreContext({ provider: delegatingProvider }),
      });
      const score = twinkleScore();
      store.getState().setScore(score);
      store.getState().selectMeasures([score.tracks[0].measures[0].id]);

      const promise = store.getState().generate(REQUEST);
      expect(store.getState().pending).toBe(true);

      store.getState().cancel();
      await promise;

      const state = store.getState();
      expect(state.pending).toBe(false);
      expect(state.error).toBeNull();
    });

    it('is a no-op when nothing is in flight', () => {
      const store = createAppStore({
        context: testStoreContext({ provider: delegatingProvider }),
      });
      expect(() => store.getState().cancel()).not.toThrow();
      expect(store.getState().pending).toBe(false);
    });

    it('a generate() call started after cancel() is unaffected', async () => {
      const store = createAppStore({
        context: testStoreContext({ provider: delegatingProvider }),
      });
      store.getState().cancel();

      await store.getState().generate(REQUEST);

      expect(store.getState().score).not.toBeNull();
      expect(store.getState().error).toBeNull();
    });
  });
});

describe('regenerated selection reverts on the next selection change', () => {
  it('clears selectionRegenerated as soon as the selection changes', () => {
    // The mark now comes from `selectRegenerated`, which the app calls with
    // the notes a finished generation job wrote; the candidate-accept
    // workflow that used to set it is gone.
    const store = createAppStore({
      context: testStoreContext({ provider: delegatingProvider }),
    });
    const score = twinkleScore();
    store.getState().setScore(score);
    const [first] = allNotes(score);

    store.getState().selectRegenerated([first.id]);
    expect(store.getState().selectionRegenerated).toBe(true);

    store
      .getState()
      .setSelection({ eventIds: [], measureIds: [], trackIds: [] });
    expect(store.getState().selectionRegenerated).toBe(false);
  });
});
