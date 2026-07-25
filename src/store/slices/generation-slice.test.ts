import { afterEach, describe, expect, it } from 'vitest';
import { createAppStore } from '../useAppStore.js';
import { testStoreContext, FakeGenerationProvider } from '../../test/store-context.js';
import { ApiGenerationProvider } from '../context.js';

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
  generateScore: (req, signal) => (injectedProvider ?? defaultFake).generateScore(req, signal),
  regenerateRegion: (req, signal) => (injectedProvider ?? defaultFake).regenerateRegion(req, signal),
};
import { extractFragment } from '../../domain/score/fragment.js';
import { findMeasure } from '../../domain/score/queries.js';
import { selectionToRange } from '../../domain/selection/selection.js';
import { twinkleScore } from '../../test/fixtures.js';
import type {
  GenerateScoreRequest,
  GenerateScoreResult,
  MusicGenerationProvider,
  RegenerateRegionRequest,
  RegenerateRegionResult,
  RegenerationCandidate,
} from '@sudobility/music_types';

const REQUEST: GenerateScoreRequest = {
  prompt: 'Create a gentle eight-measure piano piece in A minor',
  durationMeasures: 4,
  tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
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

  generateScore(request: GenerateScoreRequest, signal?: AbortSignal): Promise<GenerateScoreResult> {
    return new Promise((resolve, reject) => {
      this.generateCalls.push({ request, resolve, reject });
      signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
    });
  }

  regenerateRegion(
    request: RegenerateRegionRequest,
    signal?: AbortSignal,
  ): Promise<RegenerateRegionResult> {
    return new Promise((resolve, reject) => {
      this.regenerateCalls.push({ request, resolve, reject });
      signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
    });
  }
}

describe('generation-slice', () => {
  describe('syncModeFromSelection (finding 4)', () => {
    it('derives "regenerate" from a selection carrying content, and "generate" from an empty one', () => {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      expect(store.getState().mode).toBe('generate');

      store.getState().syncModeFromSelection({ eventIds: ['a'], measureIds: [], trackIds: [] });
      expect(store.getState().mode).toBe('regenerate');

      store.getState().syncModeFromSelection({ eventIds: [], measureIds: [], trackIds: [] });
      expect(store.getState().mode).toBe('generate');
    });

    it('is the only path that writes `mode`: selection-slice mutators call it rather than touching the field themselves', () => {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      // setSelection (and everything built on it -- toggleEvent,
      // selectMeasures, selectTrack, clearSelection) must still end up
      // deriving `mode` correctly, now that it's routed through this
      // action instead of being written inline by selection-slice.
      store.getState().setSelection({ eventIds: [], measureIds: ['m1'], trackIds: [] });
      expect(store.getState().mode).toBe('regenerate');
      store.getState().clearSelection();
      expect(store.getState().mode).toBe('generate');
    });
  });

  describe('generate', () => {
    it('adopts the provider-generated score, resets history, and marks the project dirty', async () => {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });

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
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      const promise = store.getState().generate(REQUEST);
      expect(store.getState().pending).toBe(true);
      await promise;
      expect(store.getState().pending).toBe(false);
    });

    it('a slower regenerate() call is superseded by a faster later one: final candidates reflect only the newer call', async () => {
      const provider = new ControllableProvider();
      setProvider(provider);
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      const score = twinkleScore();
      store.getState().setScore(score);
      store.getState().selectMeasures([score.tracks[0].measures[0].id]);
      const range = selectionToRange(score, store.getState().selection)!;

      const slow = store.getState().regenerate('Make this more dramatic');
      expect(provider.regenerateCalls).toHaveLength(1);

      const fast = store.getState().regenerate('Simplify this passage');
      expect(provider.regenerateCalls).toHaveLength(2);

      const fastCandidate: RegenerationCandidate = {
        id: 'fast-candidate',
        label: 'Fast',
        fragment: extractFragment(score, range),
      };
      provider.regenerateCalls[1].resolve({ candidates: [fastCandidate], warnings: [] });
      await fast;
      await slow;

      const state = store.getState();
      expect(state.pending).toBe(false);
      expect(state.error).toBeNull();
      expect(state.candidates).toEqual([fastCandidate]);
      expect(state.activeCandidateId).toBe('fast-candidate');
      expect(state.score).toBe(score); // still untouched (non-destructive preview)
    });
  });

  describe('regenerate', () => {
    function seedRegenerableSelection() {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      const score = twinkleScore();
      store.getState().setScore(score);
      const measureId = score.tracks[0].measures[0].id;
      store.getState().selectMeasures([measureId]);
      return store;
    }

    it('produces non-destructive preview candidates without touching the committed score', async () => {
      const store = seedRegenerableSelection();
      const originalScore = store.getState().score;

      await store.getState().regenerate('Make this more dramatic');

      const state = store.getState();
      expect(state.pending).toBe(false);
      expect(state.error).toBeNull();
      expect(state.candidates.length).toBeGreaterThan(0);
      expect(state.candidates.length).toBeLessThanOrEqual(3);
      expect(state.activeCandidateId).toBe(state.candidates[0].id);
      expect(state.previewFragment).toEqual(state.candidates[0].fragment);
      expect(state.score).toBe(originalScore); // untouched
      expect(state.canUndo).toBe(false); // nothing committed yet
    });

    it('sets an error and does nothing when there is no score', async () => {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      await store.getState().regenerate('Make this more dramatic');
      const state = store.getState();
      expect(state.error).toMatch(/no score/i);
      expect(state.candidates).toEqual([]);
    });

    it('sets an error and does nothing when the selection is not regenerable (nothing selected)', async () => {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      store.getState().setScore(twinkleScore());
      await store.getState().regenerate('Make this more dramatic');
      const state = store.getState();
      expect(state.error).toMatch(/select a region/i);
      expect(state.candidates).toEqual([]);
    });
  });

  describe('regenerate response validation (spec §12/§37.8, finding I1)', () => {
    /**
     * Structural/musical candidate validation moved server-side in Phase 2
     * (music_api's filterRegenerationCandidates, tested there). The client
     * boundary that remains is ApiGenerationProvider's schema re-parse of
     * the transport payload -- exercised here by backing it with a stub
     * MusicClient that returns a fixed raw result.
     */
    function fixedResultProvider(result: unknown): MusicGenerationProvider {
      const client = {
        regenerateRegion: () => Promise.resolve(result as RegenerateRegionResult),
        generateScore: () => Promise.reject(new Error('not used by this suite')),
      } as unknown as import('@sudobility/music_client').MusicClient;
      return new ApiGenerationProvider({ client, getToken: async () => 'test-token' });
    }

    function seedRegenerableSelection() {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      const score = twinkleScore();
      store.getState().setScore(score);
      const measureId = score.tracks[0].measures[0].id;
      store.getState().selectMeasures([measureId]);
      return store;
    }

    it('rejects a malformed candidate (bad shape) with an error and stores no candidates', async () => {
      const store = seedRegenerableSelection();
      setProvider(fixedResultProvider({ candidates: [{ id: 'bad', label: 'Bad' }], warnings: [] }));

      await store.getState().regenerate('Make this more dramatic');

      const state = store.getState();
      expect(state.pending).toBe(false);
      expect(state.error).not.toBeNull();
      expect(state.candidates).toEqual([]);
      expect(state.activeCandidateId).toBeNull();
      expect(state.previewFragment).toBeNull();
    });

    it('still adopts valid candidates from the real (seeded mock) provider', async () => {
      const store = seedRegenerableSelection();

      await store.getState().regenerate('Make this more dramatic');

      const state = store.getState();
      expect(state.error).toBeNull();
      expect(state.candidates.length).toBeGreaterThan(0);
    });
  });

  describe('selectCandidate / acceptCandidate / rejectCandidates', () => {
    async function seedCandidates() {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      const score = twinkleScore();
      store.getState().setScore(score);
      const measureId = score.tracks[0].measures[0].id;
      store.getState().selectMeasures([measureId]);
      await store.getState().regenerate('Simplify this passage');
      return store;
    }

    it('selectCandidate switches the active candidate/preview, and null clears it', async () => {
      const store = await seedCandidates();
      const candidates = store.getState().candidates;
      expect(candidates.length).toBeGreaterThan(1);

      store.getState().selectCandidate(candidates[1].id);
      expect(store.getState().activeCandidateId).toBe(candidates[1].id);
      expect(store.getState().previewFragment).toEqual(candidates[1].fragment);

      store.getState().selectCandidate(null);
      expect(store.getState().activeCandidateId).toBeNull();
      expect(store.getState().previewFragment).toBeNull();
    });

    it('acceptCandidate replaces the region as one undoable command, clears preview state, and remaps the selection onto the new (live) measures rather than stranding it (spec §13, finding I2)', async () => {
      const store = await seedCandidates();
      const originalScore = store.getState().score!;
      const measureIndexBefore = originalScore.tracks[0].measures[0].index;
      const measureIdBefore = store.getState().selection.measureIds[0];

      store.getState().acceptCandidate();

      const state = store.getState();
      expect(state.score).not.toBe(originalScore);
      expect(state.canUndo).toBe(true);
      expect(state.undoLabel).toMatch(/regenerate measures/i);
      expect(state.candidates).toEqual([]);
      expect(state.activeCandidateId).toBeNull();
      expect(state.previewFragment).toBeNull();

      // The selection no longer references the deleted measure...
      expect(state.selection.measureIds).not.toContain(measureIdBefore);
      // ...but still names exactly one measure, at the same position, that
      // actually resolves in the new score (not stranded).
      expect(state.selection.measureIds).toHaveLength(1);
      const newMeasure = findMeasure(state.score!, state.selection.measureIds[0]);
      expect(newMeasure).not.toBeNull();
      expect(newMeasure!.index).toBe(measureIndexBefore);
      expect(state.selection.eventIds).toEqual([]);

      const range = selectionToRange(state.score!, state.selection);
      expect(range).not.toBeNull();
      expect(range!.startTick).toBe(0);
    });

    it('regenerating the same, just-accepted region a second time succeeds immediately, without a manual reselect (spec §13, finding I2 regression)', async () => {
      const store = await seedCandidates();

      store.getState().acceptCandidate();
      expect(store.getState().error).toBeNull();

      await store.getState().regenerate('Simplify this passage');

      const state = store.getState();
      expect(state.error).toBeNull();
      expect(state.candidates.length).toBeGreaterThan(0);
      expect(state.previewFragment).not.toBeNull();
    });

    it('acceptCandidate is a no-op when there is no active candidate', async () => {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      store.getState().setScore(twinkleScore());
      store.getState().acceptCandidate();
      expect(store.getState().canUndo).toBe(false);
    });

    it('rejectCandidates discards every candidate without touching the score', async () => {
      const store = await seedCandidates();
      const scoreBefore = store.getState().score;

      store.getState().rejectCandidates();

      const state = store.getState();
      expect(state.candidates).toEqual([]);
      expect(state.activeCandidateId).toBeNull();
      expect(state.previewFragment).toBeNull();
      expect(state.score).toBe(scoreBefore);
      expect(state.canUndo).toBe(false);
    });

    it('setPreviewFragment overlays a fragment without touching activeCandidateId (A/B compare)', async () => {
      const store = await seedCandidates();
      const [active] = store.getState().candidates;

      store.getState().setPreviewFragment(null);
      expect(store.getState().previewFragment).toBeNull();
      expect(store.getState().activeCandidateId).toBe(active.id); // unchanged

      store.getState().setPreviewFragment(active.fragment);
      expect(store.getState().previewFragment).toEqual(active.fragment);
      expect(store.getState().activeCandidateId).toBe(active.id);
    });

    it('acceptCandidate still accepts the right candidate after setPreviewFragment toggled the overlay to the original', async () => {
      const store = await seedCandidates();
      store.getState().setPreviewFragment(null); // "showing original" (A/B toggle)

      store.getState().acceptCandidate();

      expect(store.getState().canUndo).toBe(true);
    });
  });

  describe('cancel', () => {
    it('aborts an in-flight generate() call and clears pending without setting an error', async () => {
      const provider = new ControllableProvider();
      setProvider(provider);
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });

      const promise = store.getState().generate(REQUEST);
      expect(store.getState().pending).toBe(true);

      store.getState().cancel();
      await promise;

      const state = store.getState();
      expect(state.pending).toBe(false);
      expect(state.error).toBeNull();
      expect(state.score).toBeNull();
    });

    it('aborts an in-flight regenerate() call and clears pending without setting an error or candidates', async () => {
      const provider = new ControllableProvider();
      setProvider(provider);
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      const score = twinkleScore();
      store.getState().setScore(score);
      store.getState().selectMeasures([score.tracks[0].measures[0].id]);

      const promise = store.getState().regenerate('Make this more dramatic');
      expect(store.getState().pending).toBe(true);

      store.getState().cancel();
      await promise;

      const state = store.getState();
      expect(state.pending).toBe(false);
      expect(state.error).toBeNull();
      expect(state.candidates).toEqual([]);
    });

    it('is a no-op when nothing is in flight', () => {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      expect(() => store.getState().cancel()).not.toThrow();
      expect(store.getState().pending).toBe(false);
    });

    it('a generate() call started after cancel() is unaffected', async () => {
      const store = createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
      store.getState().cancel();

      await store.getState().generate(REQUEST);

      expect(store.getState().score).not.toBeNull();
      expect(store.getState().error).toBeNull();
    });
  });
});
