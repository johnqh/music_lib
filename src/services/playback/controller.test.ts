import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '../../test/store-context.js';
import { createAppStore } from '../../store/useAppStore.js';
import { twinkleScore, twoTrackScore } from '../../test/fixtures.js';
import { addMeasureCommand } from '../../domain/commands/structure-commands.js';
import { createPlaybackController, PlaybackController } from './controller.js';
import type { PlaybackStoreApi } from './controller.js';
import type { PlaybackEngine, PlaybackObserver } from './types.js';

function makeStore(): PlaybackStoreApi {
  return createAppStore({ context: testStoreContext() });
}

/**
 * A fully-spied `PlaybackEngine` fake — no Tone.js/real engine involved; the
 * engine's own behavior is tested in `tone-engine.test.ts`. This suite only
 * exercises the controller's orchestration.
 *
 * `play()`/`pause()`/`stop()` fire the same observer callbacks the real
 * `TonePlaybackEngine` fires synchronously (`stop()`:
 * onActiveNotes([])/onPositionTick(0)/onStateChange('stopped'); `play()`:
 * onStateChange('playing'); `pause()`: onStateChange('paused')) — this
 * matters: an earlier version of this fake left `stop()`/`play()` as bare
 * no-ops, which meant a test could not catch a controller bug where
 * `handleScoreChange` re-read `store.getState().state`/`positionTick`
 * *after* calling `engine.stop()` and got fooled by the store having
 * already been flipped back to stopped/0 by that very call (see
 * `controller.ts`'s `pendingResume` doc). Individual tests can still
 * override any of these via `vi.mocked(engine.stop).mockImplementation(...)`
 * when they want to assert call order/args instead.
 */
function createFakeEngine(): PlaybackEngine {
  let observer: PlaybackObserver | null = null;
  return {
    initialize: vi.fn(async () => {}),
    loadScore: vi.fn(async () => {}),
    play: vi.fn(async () => {
      observer?.onStateChange('playing');
    }),
    pause: vi.fn(() => {
      observer?.onStateChange('paused');
    }),
    stop: vi.fn(() => {
      observer?.onActiveNotes([]);
      observer?.onPositionTick(0);
      observer?.onStateChange('stopped');
    }),
    seek: vi.fn(),
    setTempoMultiplier: vi.fn(),
    setLoop: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSolo: vi.fn(),
    setMetronome: vi.fn(),
    setMasterVolume: vi.fn(),
    setObserver: vi.fn((obs: PlaybackObserver | null) => {
      observer = obs;
    }),
    dispose: vi.fn(),
  };
}

function observerOf(engine: PlaybackEngine): PlaybackObserver {
  const call = (engine.setObserver as ReturnType<typeof vi.fn>).mock.calls[0];
  return call[0] as PlaybackObserver;
}

/** Drains every pending microtask (safer than a fixed number of `await Promise.resolve()` hops when multiple overlapping async chains are in flight). */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let controller: PlaybackController | null = null;

afterEach(() => {
  controller?.dispose();
  controller = null;
});

describe('PlaybackController: construction and score subscription', () => {
  it('eagerly loads an already-present score at construction', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();

    controller = createPlaybackController(engine, store);

    expect(engine.loadScore).toHaveBeenCalledTimes(1);
    expect(engine.loadScore).toHaveBeenCalledWith(store.getState().score);
  });

  it('loads a score set after construction via the store subscription', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    expect(engine.loadScore).not.toHaveBeenCalled();

    store.getState().setScore(twinkleScore());

    expect(engine.loadScore).toHaveBeenCalledTimes(1);
  });

  it('does not reload for store changes that leave `score` untouched', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    vi.mocked(engine.loadScore).mockClear();

    store.getState().setMasterVolume(0.5);

    expect(engine.loadScore).not.toHaveBeenCalled();
  });

  it('reschedules with stop -> loadScore -> play(resumeTick) when the score changes while playing', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    vi.mocked(engine.loadScore).mockClear();

    store.getState().setPlaybackState('playing');
    store.getState().setPositionTick(960);
    const callOrder: string[] = [];
    vi.mocked(engine.stop).mockImplementation(() => callOrder.push('stop'));
    vi.mocked(engine.loadScore).mockImplementation(async () => {
      callOrder.push('loadScore');
    });
    vi.mocked(engine.play).mockImplementation(async (fromTick) => {
      callOrder.push(`play:${fromTick}`);
    });

    store.getState().dispatchCommand(addMeasureCommand());
    await Promise.resolve();
    await Promise.resolve();

    expect(callOrder).toEqual(['stop', 'loadScore', 'play:960']);
  });

  it('does not stop/resume when the score changes while stopped', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    vi.mocked(engine.loadScore).mockClear();

    store.getState().dispatchCommand(addMeasureCommand());

    expect(engine.loadScore).toHaveBeenCalledTimes(1);
    expect(engine.stop).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
  });

  it('a rejected loadScore for the initial (already-present) score pushes an error toast, not an unhandled rejection', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    vi.mocked(engine.loadScore).mockRejectedValueOnce(new Error('corrupt score'));

    controller = createPlaybackController(engine, store);
    await flushAsync();

    const toast = store.getState().toasts.at(-1);
    expect(toast?.severity).toBe('error');
    expect(toast?.message).toContain('corrupt score');
  });

  it('two rapid score changes while playing produce exactly one resume, at the pre-stop position, reflecting only the final score', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();
    vi.mocked(engine.loadScore).mockClear();
    vi.mocked(engine.stop).mockClear();
    vi.mocked(engine.play).mockClear();

    store.getState().setPlaybackState('playing');
    store.getState().setPositionTick(480);

    // Two score changes dispatched back-to-back, before either's loadScore()
    // has resolved. The fake engine's stop() (see createFakeEngine's doc)
    // synchronously fires onStateChange('stopped')/onPositionTick(0) just
    // like the real engine — so by the time the second change's
    // handleScoreChange runs, the store already reads state:'stopped'/
    // positionTick:0 because of the *first* change's stop() call. The
    // controller must not be fooled by that into thinking there is nothing
    // left to resume, and must not resume at the now-0 position either.
    store.getState().dispatchCommand(addMeasureCommand());
    const scoreA = store.getState().score;
    store.getState().dispatchCommand(addMeasureCommand());
    const scoreB = store.getState().score;

    await flushAsync();

    expect(engine.loadScore).toHaveBeenCalledTimes(2);
    expect(engine.loadScore).toHaveBeenNthCalledWith(1, scoreA);
    expect(engine.loadScore).toHaveBeenNthCalledWith(2, scoreB);
    // Only the newest (scoreB) change is allowed to resume playback — the
    // stale scoreA continuation aborts after noticing a newer generation —
    // and it resumes at 480 (captured before the first stop()), not 0.
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.play).toHaveBeenCalledWith(480);
  });

  it('a rejected loadScore while playing does not leave a stale pendingResume for a later, unrelated score change', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();
    vi.mocked(engine.loadScore).mockClear();
    vi.mocked(engine.play).mockClear();

    store.getState().setPlaybackState('playing');
    store.getState().setPositionTick(480);

    vi.mocked(engine.loadScore).mockRejectedValueOnce(new Error('corrupt edit'));
    store.getState().dispatchCommand(addMeasureCommand());
    await flushAsync();

    // Sanity: the failed load itself never resumed anything, and reported an error.
    expect(engine.play).not.toHaveBeenCalled();
    expect(store.getState().toasts.at(-1)?.severity).toBe('error');

    // A later, unrelated score change (made while genuinely stopped — the
    // fake's stop() already flipped state to 'stopped') must not auto-play
    // using a pendingResume left over from the earlier failure.
    vi.mocked(engine.play).mockClear();
    store.getState().dispatchCommand(addMeasureCommand());
    await flushAsync();

    expect(engine.play).not.toHaveBeenCalled();
  });

  it('an explicit stop() during an in-flight reload cancels the queued resume', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();
    vi.mocked(engine.loadScore).mockClear();
    vi.mocked(engine.play).mockClear();

    store.getState().setPlaybackState('playing');
    store.getState().setPositionTick(480);

    // Make loadScore controllable so an explicit stop() can land while it's still pending.
    let resolveLoad!: () => void;
    vi.mocked(engine.loadScore).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    store.getState().dispatchCommand(addMeasureCommand()); // captures pendingResume, calls engine.stop(), suspends awaiting loadScore
    controller.stop(); // explicit user Stop while the reload is still in flight
    resolveLoad();
    await flushAsync();

    expect(engine.play).not.toHaveBeenCalled();
  });
});

describe('PlaybackController: observer wiring', () => {
  it('forwards onPositionTick/onActiveNotes/onStateChange into the store', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    const observer = observerOf(engine);

    observer.onPositionTick(480);
    observer.onActiveNotes(['note-1', 'note-2']);
    observer.onStateChange('playing');

    expect(store.getState().positionTick).toBe(480);
    expect(store.getState().activeNoteIds).toEqual(['note-1', 'note-2']);
    expect(store.getState().state).toBe('playing');
  });
});

describe('PlaybackController: play/pause/stop', () => {
  it('togglePlay calls engine.play() when stopped', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.togglePlay();

    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.pause).not.toHaveBeenCalled();
  });

  it('togglePlay calls engine.pause() when playing', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    // Set *after* construction, not before: the constructor's own eager
    // load for an already-present score now (correctly, matching the real
    // engine) treats state:'playing' as "was playing" and synchronously
    // stops+reloads — which would immediately flip state back to
    // 'stopped' via the fake's realistic stop() before this test ever
    // gets to call togglePlay(). Setting it afterward isolates what this
    // test actually means to exercise: togglePlay()'s own playing->pause
    // branch, not the constructor's reload behavior (covered separately
    // above).
    store.getState().setPlaybackState('playing');

    controller.togglePlay();

    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(engine.play).not.toHaveBeenCalled();
  });

  it('togglePlay is a no-op with no score loaded', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.togglePlay();

    expect(engine.play).not.toHaveBeenCalled();
  });

  it('pushes an error toast if engine.play() rejects', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    vi.mocked(engine.play).mockRejectedValue(new Error('no audio device'));
    controller = createPlaybackController(engine, store);

    controller.togglePlay();
    await Promise.resolve();
    await Promise.resolve();

    const toast = store.getState().toasts.at(-1);
    expect(toast?.severity).toBe('error');
    expect(toast?.message).toContain('no audio device');
  });

  it('togglePlay after a preview ends on its own (without an explicit stopPreview()) resumes the COMMITTED score, not the stale preview (Task 19 review fold-in a)', async () => {
    const store = makeStore();
    const committed = twinkleScore();
    store.getState().setScore(committed);
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();

    await controller.playPreview(twoTrackScore(), 0);
    vi.mocked(engine.loadScore).mockClear();
    vi.mocked(engine.play).mockClear();

    // The preview finishes on its own -- nothing calls stopPreview(), so
    // `previewing` stays (incorrectly, absent this guard) true; the engine
    // itself reports 'stopped' the way a real preview reaching its end
    // would.
    observerOf(engine).onStateChange('stopped');

    controller.togglePlay();
    await flushAsync();

    expect(engine.loadScore).toHaveBeenCalledWith(committed);
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.play).toHaveBeenCalledWith(0);

    // The committed-score subscription is live again -- confirms
    // `previewing` was actually cleared by the guard, not left stuck.
    vi.mocked(engine.loadScore).mockClear();
    store.getState().dispatchCommand(addMeasureCommand());
    await flushAsync();
    expect(engine.loadScore).toHaveBeenCalledTimes(1);
  });

  it('stop() delegates to the engine', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.stop();

    expect(engine.stop).toHaveBeenCalledTimes(1);
  });
});

describe('PlaybackController: seeking', () => {
  it('seek() delegates to the engine when a score is loaded', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.seek(123);

    expect(engine.seek).toHaveBeenCalledWith(123);
  });

  it('seek() is a no-op without a score', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.seek(123);

    expect(engine.seek).not.toHaveBeenCalled();
  });

  it('seekToMeasure() seeks to the measure start tick', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.seekToMeasure(2);

    expect(engine.seek).toHaveBeenCalledWith(score.tracks[0].measures[2].startTick);
  });

  it('goToStart() seeks to tick 0', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.goToStart();

    expect(engine.seek).toHaveBeenCalledWith(0);
  });

  it('nextMeasure()/previousMeasure() step by one measure, clamped to the score bounds', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    store.getState().setPositionTick(score.tracks[0].measures[1].startTick);
    controller.nextMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(score.tracks[0].measures[2].startTick);

    store.getState().setPositionTick(score.tracks[0].measures[1].startTick);
    controller.previousMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(score.tracks[0].measures[0].startTick);

    // clamps at the first measure
    store.getState().setPositionTick(0);
    controller.previousMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(score.tracks[0].measures[0].startTick);

    // clamps at the last measure
    const lastMeasure = score.tracks[0].measures.at(-1)!;
    store.getState().setPositionTick(lastMeasure.startTick);
    controller.nextMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(lastMeasure.startTick);
  });
});

describe('PlaybackController: loop', () => {
  it('setLoopFromSelection sets the loop from a resolvable selection', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    const firstNoteId = score.tracks[0].measures[0].voices[0].events[0].id;
    store.getState().setSelection({ eventIds: [firstNoteId], measureIds: [], trackIds: [] });
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.setLoopFromSelection();

    expect(store.getState().loopRange).not.toBeNull();
    expect(engine.setLoop).toHaveBeenCalledWith(store.getState().loopRange);
  });

  it('setLoopFromSelection is a no-op when nothing is selected', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.setLoopFromSelection();

    expect(store.getState().loopRange).toBeNull();
    expect(engine.setLoop).not.toHaveBeenCalled();
  });

  it('toggleLoop sets a whole-score loop with nothing selected, then clears it', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.toggleLoop();
    expect(store.getState().loopRange).toEqual({ startTick: 0, endTick: expect.any(Number), trackIds: [] });

    controller.toggleLoop();
    expect(store.getState().loopRange).toBeNull();
    expect(engine.setLoop).toHaveBeenLastCalledWith(null);
  });
});

describe('PlaybackController: tempo / metronome / master volume', () => {
  it('setTempoMultiplier updates the store and the engine', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.setTempoMultiplier(1.5);

    expect(store.getState().tempoMultiplier).toBe(1.5);
    expect(engine.setTempoMultiplier).toHaveBeenCalledWith(1.5);
  });

  it('setMetronome updates the store and the engine', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.setMetronome(true);

    expect(store.getState().metronome).toBe(true);
    expect(engine.setMetronome).toHaveBeenCalledWith(true);
  });

  it('setMasterVolume updates the store and the engine', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.setMasterVolume(0.6);

    expect(store.getState().masterVolume).toBe(0.6);
    expect(engine.setMasterVolume).toHaveBeenCalledWith(0.6);
  });
});

describe('PlaybackController: candidate preview (playPreview/stopPreview)', () => {
  it('playPreview loads the given score and plays from fromTick', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();
    vi.mocked(engine.loadScore).mockClear();

    const previewScore = twoTrackScore();
    await controller.playPreview(previewScore, 480);

    expect(engine.loadScore).toHaveBeenCalledWith(previewScore);
    expect(engine.play).toHaveBeenCalledWith(480);
  });

  it('suspends the committed-score subscription while previewing: a committed score change does not reload the engine', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();

    await controller.playPreview(twoTrackScore());
    vi.mocked(engine.loadScore).mockClear();
    vi.mocked(engine.play).mockClear();

    store.getState().dispatchCommand(addMeasureCommand());
    await flushAsync();

    expect(engine.loadScore).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
  });

  it('stopPreview reloads the committed score and resumes the subscription', async () => {
    const store = makeStore();
    const committed = twinkleScore();
    store.getState().setScore(committed);
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();

    await controller.playPreview(twoTrackScore());
    vi.mocked(engine.loadScore).mockClear();

    controller.stopPreview();
    await flushAsync();

    expect(engine.stop).toHaveBeenCalled();
    expect(engine.loadScore).toHaveBeenCalledWith(committed);

    // The subscription is live again afterward.
    vi.mocked(engine.loadScore).mockClear();
    store.getState().dispatchCommand(addMeasureCommand());
    await flushAsync();
    expect(engine.loadScore).toHaveBeenCalledTimes(1);
  });

  it('stopPreview is a no-op when nothing is being previewed', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.stopPreview();

    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('only the latest of two rapid playPreview() calls resumes playback', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();
    vi.mocked(engine.play).mockClear();

    let resolveFirstLoad!: () => void;
    vi.mocked(engine.loadScore).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstLoad = resolve;
        }),
    );

    const first = controller.playPreview(twoTrackScore(), 0);
    const second = controller.playPreview(twinkleScore(), 240);
    resolveFirstLoad();
    await Promise.all([first, second]);

    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.play).toHaveBeenCalledWith(240);
  });

  it('a failed playPreview resyncs the engine to the committed score rather than stranding it mid-preview', async () => {
    const store = makeStore();
    const committed = twinkleScore();
    store.getState().setScore(committed);
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();
    vi.mocked(engine.loadScore).mockClear();

    vi.mocked(engine.loadScore).mockRejectedValueOnce(new Error('corrupt preview'));
    await controller.playPreview(twoTrackScore(), 0);

    // The failed preview load's own engine.stop() (inside playPreview) plus
    // the resync's engine.stop() both fire; what matters is the *last*
    // loadScore call is the committed score, not the failed preview.
    expect(engine.loadScore).toHaveBeenLastCalledWith(committed);
    const toast = store.getState().toasts.at(-1);
    expect(toast?.severity).toBe('error');
    expect(toast?.message).toContain('corrupt preview');

    // The subscription is live again afterward -- confirms `previewing` was cleared.
    vi.mocked(engine.loadScore).mockClear();
    store.getState().dispatchCommand(addMeasureCommand());
    await flushAsync();
    expect(engine.loadScore).toHaveBeenCalledTimes(1);
  });
});

describe('PlaybackController.dispose', () => {
  it('disposes the engine and stops reacting to further score changes', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    const c = createPlaybackController(engine, store);

    c.dispose();
    store.getState().setScore(twoTrackScore());

    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(engine.loadScore).not.toHaveBeenCalled();
  });
});
