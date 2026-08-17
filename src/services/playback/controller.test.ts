import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '../../test/store-context.js';
import { createAppStore } from '../../store/useAppStore.js';
import { twinkleScore, twoTrackScore } from '../../test/fixtures.js';
import { addMeasureCommand, changeTrackPropsCommand } from '../../domain/commands/structure-commands.js';
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
    applyMix: vi.fn(),
    setTrackSolo: vi.fn(),
    setMetronome: vi.fn(),
    setMasterVolume: vi.fn(),
    setObserver: vi.fn((obs: PlaybackObserver | null) => {
      observer = obs;
    }),
    noteOn: vi.fn(),
  noteOff: vi.fn(),
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

});

describe('PlaybackController: observer wiring', () => {
  it('publishes position and sounding notes on the bus, not into the store', () => {
    // The split that keeps a 30Hz value out of Zustand: nothing the engine
    // reports at that rate may reach a store subscriber.
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    const observer = observerOf(engine);
    const positions: number[] = [];
    const sounding: string[][] = [];
    controller.bus.onPosition((t) => positions.push(t));
    controller.bus.onSounding((notes) => sounding.push(notes.map((n) => n.noteId)));

    observer.onPositionTick(480);
    observer.onActiveNotes([
      { noteId: 'note-1', trackId: 't', midi: 60 },
      { noteId: 'note-2', trackId: 't', midi: 64 },
    ]);
    observer.onStateChange('playing');

    expect(positions).toEqual([480]);
    expect(sounding).toEqual([['note-1', 'note-2']]);
    // Transport state is low-frequency and still belongs in the store.
    expect(store.getState().state).toBe('playing');
  });

  it('commits the engine position to the edit caret when the transport stops', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    const observer = observerOf(engine);

    observer.onStateChange('playing');
    observer.onPositionTick(1920);
    observer.onStateChange('paused');

    expect(store.getState().caretTick).toBe(1920);
  });

  it('leaves the edit caret alone while playing', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    const observer = observerOf(engine);
    store.getState().setCaretTick(240);

    observer.onStateChange('playing');
    observer.onPositionTick(1920);

    expect(store.getState().caretTick).toBe(240);
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

    store.getState().setCaretTick(score.tracks[0].measures[1].startTick);
    controller.nextMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(score.tracks[0].measures[2].startTick);

    store.getState().setCaretTick(score.tracks[0].measures[1].startTick);
    controller.previousMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(score.tracks[0].measures[0].startTick);

    // clamps at the first measure
    store.getState().setCaretTick(0);
    controller.previousMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(score.tracks[0].measures[0].startTick);

    // clamps at the last measure
    const lastMeasure = score.tracks[0].measures.at(-1)!;
    store.getState().setCaretTick(lastMeasure.startTick);
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

describe('togglePlay selection handling', () => {
  let controller: PlaybackController | null = null;
  afterEach(() => {
    controller?.dispose();
    controller = null;
  });

  function seeded() {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    store.getState().setSelection({ eventIds: ['a'], measureIds: [], trackIds: [] });
    return { store, engine };
  }

  it('clears the selection when starting playback', () => {
    const { store } = seeded();
    controller!.togglePlay();
    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('does not clear the selection when pausing', () => {
    const { store } = seeded();
    store.getState().setPlaybackState('playing');
    store.getState().setSelection({ eventIds: ['a'], measureIds: [], trackIds: [] });

    controller!.togglePlay();

    expect(store.getState().state).toBe('paused');
    expect(store.getState().selection.eventIds).toEqual(['a']);
  });

  it('does not clear the selection on stop', () => {
    const { store } = seeded();
    controller!.stop();
    expect(store.getState().selection.eventIds).toEqual(['a']);
  });

  it('does not clear the selection on seek', () => {
    const { store } = seeded();
    controller!.seek(480);
    expect(store.getState().selection.eventIds).toEqual(['a']);
  });

  it('is a no-op with no score, leaving the selection alone', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    store.getState().setSelection({ eventIds: ['a'], measureIds: [], trackIds: [] });

    controller.togglePlay();

    expect(engine.play).not.toHaveBeenCalled();
    expect(store.getState().selection.eventIds).toEqual(['a']);
  });
});

describe('PlaybackController: auditioning', () => {
  it('passes a held note straight to the engine without touching transport state', () => {
    // Auditioning is not playback: it must not move the caret, change the
    // playing/paused state, or join the active-note highlighting.
    const engine = createFakeEngine();
    const store = createAppStore({ context: testStoreContext() });
    const controller = createPlaybackController(engine, store);
    const before = store.getState().state;

    controller.noteOn(60, 0);
    controller.noteOff(60);

    expect(vi.mocked(engine.noteOn)).toHaveBeenCalledWith(60, 0, false);
    expect(vi.mocked(engine.noteOff)).toHaveBeenCalledWith(60);
    expect(store.getState().state).toBe(before);
    expect(store.getState().caretTick).toBe(0);
    controller.dispose();
  });

  it('forwards the percussion flag, so a drum track auditions on the kit', () => {
    // Without it the tap sounded a pitched instrument while the same note
    // played back as a drum.
    const engine = createFakeEngine();
    const store = createAppStore({ context: testStoreContext() });
    const controller = createPlaybackController(engine, store);

    controller.noteOn(38, 0, true);

    expect(vi.mocked(engine.noteOn)).toHaveBeenCalledWith(38, 0, true);
    controller.dispose();
  });
});

describe('PlaybackController: hidden tracks are silent', () => {
  /** Every `setTrackMute(id, muted)` the engine was told, as a map of the final value per track. */
  function muteState(engine: PlaybackEngine): Record<string, boolean> {
    const calls = (engine.setTrackMute as ReturnType<typeof vi.fn>).mock.calls;
    const out: Record<string, boolean> = {};
    for (const [trackId, muted] of calls) out[trackId as string] = muted as boolean;
    return out;
  }

  it('mutes a track that is hidden and leaves a visible one alone', async () => {
    // Visibility reached the notation and the print sheet but never the audio,
    // so a hidden track went on playing.
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();

    const [first, second] = store.getState().score!.tracks;
    store.getState().setVisibleTracks([first.id]);
    await flushAsync();

    expect(muteState(engine)[second.id]).toBe(true);
    expect(muteState(engine)[first.id]).toBe(false);
  });

  it('unmutes a track when it is shown again', async () => {
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();

    const [first, second] = store.getState().score!.tracks;
    store.getState().setVisibleTracks([first.id]);
    await flushAsync();
    store.getState().setVisibleTracks([first.id, second.id]);
    await flushAsync();

    expect(muteState(engine)[second.id]).toBe(false);
  });

  it('re-applies visibility after a score change, which reseeds mute from the score', async () => {
    // `loadScore` seeds each channel's mute from `Track.muted`, so without a
    // re-apply the next edit would let a hidden track start sounding again.
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();

    const [first, second] = store.getState().score!.tracks;
    store.getState().setVisibleTracks([first.id]);
    await flushAsync();

    (engine.setTrackMute as ReturnType<typeof vi.fn>).mockClear();
    store.getState().setScore({ ...store.getState().score! }); // new identity = an edit
    await flushAsync();

    expect(muteState(engine)[second.id]).toBe(true);
  });

  it('keeps an explicit mute muted after the track is hidden and shown again', async () => {
    // Visibility must not overwrite what the user asked for; the two combine.
    const store = makeStore();
    const base = twoTrackScore();
    const muted = { ...base, tracks: [base.tracks[0], { ...base.tracks[1], muted: true }] };
    store.getState().setScore(muted);
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();

    const [first, second] = store.getState().score!.tracks;
    store.getState().setVisibleTracks([first.id]);
    await flushAsync();
    store.getState().setVisibleTracks([first.id, second.id]);
    await flushAsync();

    expect(muteState(engine)[second.id]).toBe(true);
  });
});

describe('PlaybackController: synth loading', () => {
  it('puts the engine load state in the store, so the UI can show it', () => {
    // The soundfont engine cannot make a sound for several seconds after the
    // first press of Play. Nothing else tells the app that, and without it the
    // transport simply looked broken for the whole load.
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    const observer = observerOf(engine);

    expect(store.getState().synthLoad).toEqual({ status: 'idle' });

    observer.onLoadStateChange?.({ status: 'loading', fraction: 0.25 });
    expect(store.getState().synthLoad).toEqual({ status: 'loading', fraction: 0.25 });

    observer.onLoadStateChange?.({ status: 'ready' });
    expect(store.getState().synthLoad).toEqual({ status: 'ready' });
  });

  it('carries a failure through, so silence can be explained', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    observerOf(engine).onLoadStateChange?.({ status: 'failed', message: 'Soundfont fetch failed: 404' });
    expect(store.getState().synthLoad).toEqual({
      status: 'failed',
      message: 'Soundfont fetch failed: 404',
    });
  });
});

describe('PlaybackController: score changes while playing', () => {
  it('applies mix to the engine without reloading or stopping', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await Promise.resolve();

    vi.mocked(engine.loadScore).mockClear();
    vi.mocked(engine.stop).mockClear();
    store.getState().setPlaybackState('playing');

    const trackId = store.getState().score!.tracks[0].id;
    store.getState().dispatchCommand(changeTrackPropsCommand(trackId, { muted: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.applyMix).toHaveBeenCalled();
    expect(engine.loadScore).not.toHaveBeenCalled();
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('loads the score when a change arrives while stopped', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await Promise.resolve();

    vi.mocked(engine.loadScore).mockClear();
    store.getState().dispatchCommand(addMeasureCommand());
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.loadScore).toHaveBeenCalled();
  });

  it('never resumes playback on its own', async () => {
    // pendingResume existed to restart playback after a stop-reload cycle.
    // There is no such cycle now, so nothing may call play() but the user.
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await Promise.resolve();

    store.getState().setPlaybackState('playing');
    vi.mocked(engine.play).mockClear();

    const trackId = store.getState().score!.tracks[0].id;
    store.getState().dispatchCommand(changeTrackPropsCommand(trackId, { volume: 0.3 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.play).not.toHaveBeenCalled();
  });
});
