/**
 * Whole-score generation, and the `mode` the selection derives.
 *
 * Region regeneration used to live here too, along with a non-destructive
 * candidate preview and an accept step. That workflow is gone: regeneration
 * is a server-side job now, which applies its own result, so a client-side
 * preview had nothing to preview and nobody to accept it.
 */
import type { StateCreator } from 'zustand';
import { ApiGenerationProvider, type StoreContext } from '../context.js';
import type { GenerateScoreRequest } from '@sudobility/music_types';
import type { ScoreSelection } from '@sudobility/music_types';
import type { AppState } from '../useAppStore.js';

export type GenerationMode = 'generate' | 'regenerate';

/**
 * `mode` reflects the current selection (spec: "mode ... derived from
 * selection non-empty"): a selection carrying actual content (selected
 * events/measures, or an explicit tick range) puts the generation panel in
 * "regenerate" mode; an empty selection (including a bare track-only
 * selection, which has no tick extent of its own) means "generate" a whole
 * new score. Kept as real state (not a read-time selector) so components
 * can read it without knowing the derivation rule — but the *write* is
 * this slice's own responsibility (`syncModeFromSelection`, below):
 * `selection-slice` calls that action after every selection change rather
 * than writing `state.mode` itself, so `generation-slice` stays the only
 * code that ever touches its own field.
 */
export function deriveGenerationMode(
  selection: ScoreSelection
): GenerationMode {
  const hasContent =
    selection.eventIds.length > 0 ||
    selection.measureIds.length > 0 ||
    selection.range !== undefined;
  return hasContent ? 'regenerate' : 'generate';
}

export type GenerationSlice = {
  mode: GenerationMode;
  pending: boolean;
  lastRequest: GenerateScoreRequest | null;
  error: string | null;

  /** Recomputes `mode` from `selection` via `deriveGenerationMode`. Called by `selection-slice`'s mutators after every selection change; not normally called directly by UI code. */
  syncModeFromSelection: (selection: ScoreSelection) => void;
  /** Generates a brand-new score from `params` and adopts it (spec §39 items 3-5): validated/repaired server-side by music_api, then `setScore(..., { resetHistory: true })`. */
  generate: (params: GenerateScoreRequest) => Promise<void>;
  /**
   * Aborts whichever `generate()`/`regenerate()` call is currently in
   * flight (the generation panel's "Cancel" button) and clears `pending`.
   * Does not touch `candidates`/`error`/`score` — a cancelled request
   * simply never gets to write its result; whatever was previewed/
   * committed before the cancelled call started is left exactly as it
   * was. A no-op if nothing is in flight.
   */
  cancel: () => void;
};

export function createGenerationSlice(
  context: StoreContext
): StateCreator<AppState, [['zustand/immer', never]], [], GenerationSlice> {
  const provider = context.provider ?? new ApiGenerationProvider(context);
  return (set, get) => {
    // `requestToken`/`abortController` guard against out-of-order responses:
    // `generate`/`regenerate` are async and there's nothing stopping a
    // component from firing a second call (a new prompt, a revised
    // instruction) before the first one's provider round-trip has settled.
    // Without this, the *older* call's `.then`/`.catch` can land after the
    // newer one and clobber its `pending`/`candidates`/`score` with stale
    // data. `beginRequest()` bumps `requestToken` and aborts+replaces
    // `abortController` every time either action starts, so:
    //  - the previous in-flight provider call gets an aborted `AbortSignal`
    //    (both `MusicGenerationProvider` methods accept one) and, once its
    //    promise actually settles, is silently discarded on the `token !==
    //    requestToken` check below — never writing over the newer call's
    //    state.
    //  - a real (non-abort) error from a since-superseded call is likewise
    //    discarded, not surfaced as `error` (only the *current* call's own
    //    outcome should ever reach the user).
    // One shared token/controller for both actions (rather than one each) is
    // deliberate: `generate` and `regenerate` both drive the same
    // `pending`/`error` fields, so starting either one should supersede
    // whatever async generation-panel request was previously in flight,
    // regardless of which action it was.
    let requestToken = 0;
    let abortController: AbortController | null = null;

    function beginRequest(): { token: number; signal: AbortSignal } {
      abortController?.abort();
      const controller = new AbortController();
      abortController = controller;
      requestToken += 1;
      return { token: requestToken, signal: controller.signal };
    }

    return {
      mode: 'generate',
      pending: false,
      lastRequest: null,
      error: null,

      syncModeFromSelection: selection => {
        set(state => {
          state.mode = deriveGenerationMode(selection);
        });
      },

      generate: async params => {
        const { token, signal } = beginRequest();
        set(state => {
          state.pending = true;
          state.error = null;
        });
        try {
          const result = await provider.generateScore(params, signal);
          if (token !== requestToken) return; // superseded by a newer generate()/regenerate() call
          // Server-side sanitize already ran (music_api); the provider re-parsed the shape.
          const score = result.score;
          get().setScore(score, { resetHistory: true });
          set(state => {
            state.pending = false;
            state.lastRequest = params;
          });
          get().markDirty();
        } catch (error) {
          if (token !== requestToken) return; // superseded; the newer call now owns pending/error
          if (isAbortError(error)) {
            set(state => {
              state.pending = false;
            });
            return;
          }
          set(state => {
            state.pending = false;
            state.error = errorMessage(error);
          });
        }
      },

      cancel: () => {
        abortController?.abort();
        set(state => {
          state.pending = false;
        });
      },
    };
  };
}

/** True for the `AbortError` a `MusicGenerationProvider` call rejects with when its `AbortSignal` fires (both the mock provider's `throwIfAborted` and the DOM `fetch`/`AbortController` convention use this name). Cancellations from `beginRequest()` superseding an in-flight call are intentionally silent — never surfaced via `error` — since they reflect the *user* moving on to a newer request, not a failure. */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
