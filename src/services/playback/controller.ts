/**
 * Playback controller (spec §10, §22, Task 13 brief): the single bridge
 * between the Zustand store and a `PlaybackEngine`. `playback-slice` is
 * data-only (see its own doc comment) — this module is where that data
 * actually becomes sound, and where engine callbacks flow back into the
 * store.
 *
 * `createPlaybackController(engine, store)` is the testable factory
 * (matching `features/score-editor/editing.ts`'s `EditorStoreApi` DI
 * convention); `playbackController` is the ready-made singleton the app
 * uses, wired to the registered platform's engine and the app-wide
 * `useAppStore`. Every mutating method here is meant to be called
 * directly by UI (`components/transport/TransportBar.tsx`), not dispatched
 * as a store action — playback is real-time device control, not score
 * history.
 */
import type { PlaybackEngine } from './types.js';
import { scoreEndTick } from '../../domain/score/queries.js';
import { selectionToRange } from '../../domain/selection/selection.js';
import type { ScoreRange } from '../../domain/selection/types.js';
import type { Score } from '@sudobility/music_types';
import { getMusicPlatform } from '../../platform/registry.js';
import { selectVisibleTrackIds } from '../../store/selectors.js';
import { useAppStore } from '../../store/useAppStore.js';
import type { createAppStore } from '../../store/useAppStore.js';
import { PlaybackBus } from './bus.js';

/** The store shape this module operates on: same type `useAppStore`/`createAppStore()` produce (matches `features/score-editor/editing.ts`'s `EditorStoreApi`). */
export type PlaybackStoreApi = ReturnType<typeof createAppStore>;

/** The measure a domain tick falls in, on the score's first track (every track shares the same measure grid once `rebuildMeasureTicks` has run — same convention as `store/selectors.ts`). `null` if the score has no measures. */
function measureAt(score: Score, tick: number) {
  const track = score.tracks[0];
  if (!track || track.measures.length === 0) return null;
  return (
    track.measures.find((m) => tick >= m.startTick && tick < m.startTick + m.durationTicks) ??
    track.measures[track.measures.length - 1]
  );
}

export class PlaybackController {
  private readonly unsubscribe: () => void;

  /**
   * Where position and sounding notes go instead of the store.
   *
   * Both arrive far too often to route through Zustand — see `bus.ts`. What
   * still goes to the store is the low-frequency half: transport state and
   * load progress, which behave like ordinary React state because they are.
   */
  readonly bus = new PlaybackBus();

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly store: PlaybackStoreApi,
  ) {
    engine.setObserver({
      onPositionTick: (tick) => this.bus.publishPosition(tick),
      onActiveNotes: (notes) => this.bus.publishSounding(notes),
      onStateChange: (state) => {
        this.bus.publishTransport(state);
        this.store.getState().setPlaybackState(state);
        // Stopping or pausing commits the engine's final position to the edit
        // caret, so the two coincide whenever the transport is not running —
        // which is the whole basis of "play from the caret" still working.
        if (state !== 'playing') this.store.getState().setCaretTick(this.bus.positionTick);
      },
      // Optional on the contract: an engine with nothing to load never calls it.
      onLoadStateChange: (state) => this.store.getState().setSynthLoad(state),
    });

    let lastVisibleTrackIds: string[] | null = this.store.getState().visibleTrackIds;
    let lastScore: Score | null = this.store.getState().score;
    // Routed through the same guarded `handleScoreChange` path as every
    // later change (try/catch -> error toast on a rejected loadScore),
    // rather than a bare fire-and-forget `engine.loadScore(...)` — a
    // corrupt initial score must not surface as an unhandled rejection.
    if (lastScore) this.handleScoreChange(lastScore);

    this.unsubscribe = this.store.subscribe((state) => {
      if (state.score !== lastScore) {
        lastScore = state.score;
        if (lastScore) this.handleScoreChange(lastScore);
        return;
      }
      // Hiding a track silences it. Pushed straight to the engine rather than
      // reloading the score: muting is a per-channel gain decision, so it takes
      // effect mid-playback without rescheduling a note.
      if (state.visibleTrackIds !== lastVisibleTrackIds) {
        lastVisibleTrackIds = state.visibleTrackIds;
        this.applyTrackAudibility();
      }
    });
  }

  /** Releases the store subscription and disposes the engine; only meaningful for a controller that isn't the app-wide singleton (e.g. tests). */
  dispose(): void {
    this.unsubscribe();
    this.engine.dispose();
  }

  // ---- transport ---------------------------------------------------------

  togglePlay(): void {
    const { state, score } = this.store.getState();
    if (!score) return;
    if (state === 'playing') {
      this.engine.pause();
    } else {
      // Starting playback deselects. Only on the ->playing transition:
      // `pause()` and `stop()` deliberately leave the selection alone, so
      // pausing to edit keeps what you had selected.
      //
      // "Play from the caret" needs no code here — the engine resumes from
      // the transport position, and a caret seek is exactly what set it.
      this.store.getState().clearSelection();
      this.engine.play().catch((error: unknown) => this.reportError('Playback failed to start', error));
    }
  }

  stop(): void {
    this.engine.stop();
  }

  seek(tick: number): void {
    if (!this.store.getState().score) return;
    const target = Math.max(0, tick);
    // The caret moves with an explicit seek whether or not the transport is
    // running: seeking *is* the user saying where they are.
    this.store.getState().setCaretTick(target);
    this.engine.seek(target);
  }

  seekToMeasure(measureIndex: number): void {
    const score = this.store.getState().score;
    const measure = score?.tracks[0]?.measures.find((m) => m.index === measureIndex);
    if (!measure) return;
    this.seek(measure.startTick);
  }

  goToStart(): void {
    this.seek(0);
  }

  previousMeasure(): void {
    const { score, caretTick } = this.store.getState();
    if (!score) return;
    const current = measureAt(score, caretTick);
    if (!current) return;
    this.seekToMeasure(Math.max(0, current.index - 1));
  }

  nextMeasure(): void {
    const { score, caretTick } = this.store.getState();
    if (!score) return;
    const current = measureAt(score, caretTick);
    if (!current) return;
    const lastIndex = score.tracks[0].measures.length - 1;
    this.seekToMeasure(Math.min(lastIndex, current.index + 1));
  }

  // ---- loop ---------------------------------------------------------------

  private setLoop(range: ScoreRange | null): void {
    this.store.getState().setLoopRange(range);
    this.engine.setLoop(range);
  }

  /** Sets the loop range from the current selection (spec §22); a no-op if the selection has no resolvable tick extent. */
  setLoopFromSelection(): void {
    const { score, selection } = this.store.getState();
    if (!score) return;
    const range = selectionToRange(score, selection);
    if (!range) return;
    this.setLoop(range);
  }

  clearLoop(): void {
    this.setLoop(null);
  }

  /** The transport's single "loop toggle" control (spec §22): clears an active loop, or sets one (from the selection, falling back to the whole score) when none is active. */
  toggleLoop(): void {
    const { score, loopRange, selection } = this.store.getState();
    if (loopRange) {
      this.clearLoop();
      return;
    }
    if (!score) return;
    const range = selectionToRange(score, selection) ?? { startTick: 0, endTick: scoreEndTick(score), trackIds: [] };
    this.setLoop(range);
  }

  // ---- tempo / metronome / volume ------------------------------------------

  setTempoMultiplier(multiplier: number): void {
    this.store.getState().setTempoMultiplier(multiplier);
    this.engine.setTempoMultiplier(multiplier);
  }

  setMetronome(enabled: boolean): void {
    this.store.getState().setMetronome(enabled);
    this.engine.setMetronome(enabled);
  }

  setMasterVolume(volume: number): void {
    this.store.getState().setMasterVolume(volume);
    this.engine.setMasterVolume(volume);
  }

  /**
   * Sounds a pitch for as long as it is held — auditioning a key while editing.
   *
   * Passes straight to the engine and touches no store state on purpose: this
   * is not transport playback, so it must not move the caret, set the
   * playing/paused state, or appear in the active-note highlighting that
   * follows the score.
   *
   * `isPercussion` must be passed for a percussion-clef track, or the tap
   * sounds a pitched instrument while the same note plays back as a drum.
   */
  noteOn(midi: number, program: number, isPercussion = false): void {
    this.engine.noteOn(midi, program, isPercussion);
  }

  noteOff(midi: number): void {
    this.engine.noteOff(midi);
  }

  // ---- internals ------------------------------------------------------------

  /**
   * Reacts to the store's `score` reference changing.
   *
   * Two branches, and the edit lock (`store/slices/score-slice.ts`) is what
   * allows the first: while playing, the only score change that can reach here
   * is a mix change, so there is nothing to reschedule and the engine keeps its
   * queue intact.
   *
   * This used to be a stop-reload-seek-resume cycle, with a generation counter
   * deciding which of several in-flight calls owned the resume, and the resume
   * captured up front because the engine's own `stop()` synchronously reset the
   * store state that a later call would otherwise have read. All of it existed
   * to make editing during playback safe. Editing during playback is now
   * refused, so all of it is gone — and if the lock is ever loosened, this is
   * the code that has to come back.
   */
  private handleScoreChange(score: Score): void {
    if (this.store.getState().state === 'playing') {
      this.engine.applyMix(score);
      return;
    }
    void this.loadScore(score);
  }

  /** Loads a score into the engine, reporting a failure rather than swallowing it. */
  private async loadScore(score: Score): Promise<void> {
    try {
      await this.engine.loadScore(score);
      // loadScore reseeds every channel's mute from `Track.muted`, so hidden
      // tracks would sound again on the next load without this.
      this.applyTrackAudibility();
    } catch (error) {
      this.reportError('Failed to load the score for playback', error);
    }
  }

  /**
   * Pushes per-track audibility to the engine: a track sounds only if it is
   * visible *and* not muted.
   *
   * Visibility used to reach the notation and the print sheet but never the
   * audio, so hiding a track removed it from view while it went on playing.
   * Combining the two axes here rather than writing visibility into the
   * channel's mute means an explicit mute survives being hidden and shown
   * again — the score keeps the user's intent, and this only ever derives from
   * it.
   *
   * Must run after every `loadScore`, which reseeds each channel's mute from
   * `Track.muted` and so forgets anything visibility had to say.
   */
  private applyTrackAudibility(): void {
    const state = this.store.getState();
    const score = state.score;
    if (!score) return;
    const visible = new Set(selectVisibleTrackIds(state));
    for (const track of score.tracks) {
      this.engine.setTrackMute(track.id, track.muted || !visible.has(track.id));
    }
  }

  private reportError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.store.getState().pushToast({ message: `${message}: ${detail}`, severity: 'error' });
  }
}

export function createPlaybackController(engine: PlaybackEngine, store: PlaybackStoreApi): PlaybackController {
  return new PlaybackController(engine, store);
}

let singleton: PlaybackController | null = null;

function realController(): PlaybackController {
  if (!singleton) {
    // The engine comes from the registry, not from here: this file must not
    // know which platform it is running on.
    singleton = createPlaybackController(getMusicPlatform().playback, useAppStore);
  }
  return singleton;
}

/**
 * The app's single running controller, wired to the registered platform's
 * engine and the app-wide store — constructed lazily on first property access
 * (a Proxy) so importing this module neither builds an audio graph nor requires
 * `initializeAppStore`/`initializeMusicPlatform` to have run yet.
 *
 * That laziness is why every existing `playbackController.*` call site kept
 * working unchanged when the engine moved out to music_io: the Proxy resolves
 * the engine on first use, by which time the app has registered a platform.
 */
export const playbackController: PlaybackController = new Proxy({} as PlaybackController, {
  get(_target, prop) {
    const controller = realController();
    const value = Reflect.get(controller, prop, controller);
    return typeof value === 'function' ? value.bind(controller) : value;
  },
});
