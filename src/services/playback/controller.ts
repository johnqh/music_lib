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
 * uses, wired to a real `TonePlaybackEngine` and the app-wide
 * `useAppStore`. Every mutating method here is meant to be called
 * directly by UI (`components/transport/TransportBar.tsx`), not dispatched
 * as a store action — playback is real-time device control, not score
 * history.
 */
import { TonePlaybackEngine } from '../../adapters/tone/tone-engine';
import type { PlaybackEngine } from './types';
import { scoreEndTick } from '../../domain/score/queries';
import { selectionToRange } from '../../domain/selection/selection';
import type { ScoreRange } from '../../domain/selection/types';
import type { Score } from '@sudobility/music_types';
import { useAppStore } from '../../store/useAppStore';
import type { createAppStore } from '../../store/useAppStore';

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
   * Bumped by every `handleScoreChange` call and by `dispose()`. Rapid
   * successive score changes (e.g. two edits dispatched back-to-back) each
   * start their own `handleScoreChange`, and since `engine.loadScore`/
   * `engine.play` are async, an *older* call's continuation can still be
   * in flight when a *newer* one starts. Each call captures its own
   * generation and checks it again after `await engine.loadScore(...)`;
   * a stale (superseded) call aborts before its final `engine.play(...)` —
   * the load itself is left to complete (harmless: the next, newer call's
   * `loadScore` immediately overwrites it), but only the newest call is
   * allowed to resume playback, so a burst of edits produces exactly one
   * `engine.play()` reflecting the final score, not one per edit.
   */
  private scoreChangeGeneration = 0;
  /**
   * Set while a burst of one or more overlapping `handleScoreChange` calls
   * owes a resume once the *last* of them finishes loading. Captured
   * explicitly rather than re-derived from `store.getState().state`/
   * `positionTick` after the fact: the real engine's `stop()` synchronously
   * fires `onStateChange('stopped')`/`onPositionTick(0)` through this
   * controller's own observer wiring, so a second `handleScoreChange` call
   * arriving right after the first one's `engine.stop()` would otherwise
   * see `state: 'stopped'`/`positionTick: 0` and wrongly conclude nothing
   * needs to resume (see `handleScoreChange`'s doc for the full story).
   *
   * Two more invariants a value living this long has to uphold, both fixed
   * after being caught in review:
   *
   * 1. A failed `loadScore` must clear it (in `handleScoreChange`'s
   *    `catch`, guarded by `scoreChangeGeneration` so a *stale/superseded*
   *    call's failure can't clear a *newer*, still-in-flight call's
   *    legitimately-owned pending resume) — otherwise a later, completely
   *    unrelated score change (made while genuinely stopped) would see a
   *    stale `pendingResume` left over from the earlier failure and
   *    auto-play when the user never asked to resume anything.
   * 2. Any explicit user transport action — `stop()`, `togglePlay()` (both
   *    branches), `seek()` (and everything that funnels through it:
   *    `seekToMeasure`/`goToStart`/`previousMeasure`/`nextMeasure`) — must
   *    clear it, so a `handleScoreChange` that's still in flight when the
   *    user stops/pauses/seeks doesn't resurrect playback out from under
   *    them once its `loadScore` eventually resolves. `handleScoreChange`'s
   *    own *internal* `this.engine.stop()` call (the "stop" half of
   *    stop-reload-seek-resume) intentionally does **not** go through the
   *    public `stop()` method and so never clears the very `pendingResume`
   *    it just captured for itself.
   */
  private pendingResume: { tick: number } | null = null;

  /**
   * True while a non-destructive candidate preview (spec §13, §37.9 —
   * `playPreview`/`stopPreview`, below) is driving the engine instead of
   * the committed score. While true, the committed-score subscription
   * (constructor, below) suspends itself rather than reloading the
   * engine out from under the preview: `generation-slice`'s preview
   * machinery never writes to the committed `score` field, so this flag
   * is cheap insurance, and it documents the invariant that nothing in
   * this controller should treat a preview's temporarily-loaded score as
   * "the" score. `stopPreview()` clears it and explicitly reloads
   * whatever the committed score currently is, resyncing the engine.
   */
  private previewing = false;
  /**
   * Bumped by every `playPreview()`/`stopPreview()` call (mirrors
   * `scoreChangeGeneration`'s role for `handleScoreChange`): guards
   * against a stale `playPreview()` call's `await engine.loadScore(...)`
   * resolving after a *newer* `playPreview`/`stopPreview` call has already
   * moved the engine on to something else (e.g. rapidly switching which
   * regeneration candidate is being previewed).
   */
  private previewGeneration = 0;

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly store: PlaybackStoreApi,
  ) {
    engine.setObserver({
      onPositionTick: (tick) => this.store.getState().setPositionTick(tick),
      onActiveNotes: (ids) => this.store.getState().setActiveNoteIds(ids),
      onStateChange: (state) => this.store.getState().setPlaybackState(state),
    });

    let lastScore: Score | null = this.store.getState().score;
    // Routed through the same guarded `handleScoreChange` path as every
    // later change (try/catch -> error toast on a rejected loadScore),
    // rather than a bare fire-and-forget `engine.loadScore(...)` — a
    // corrupt initial score must not surface as an unhandled rejection.
    if (lastScore) void this.handleScoreChange(lastScore);

    this.unsubscribe = this.store.subscribe((state) => {
      if (state.score !== lastScore) {
        lastScore = state.score;
        if (this.previewing) return; // a candidate preview owns the engine right now; stopPreview() resyncs to the committed score
        if (lastScore) void this.handleScoreChange(lastScore);
      }
    });
  }

  /** Releases the store subscription and disposes the engine; only meaningful for a controller that isn't the app-wide singleton (e.g. tests). */
  dispose(): void {
    this.scoreChangeGeneration++; // invalidate any handleScoreChange still in flight so it won't call engine.play() post-dispose
    this.previewGeneration++; // invalidate any playPreview() still in flight
    this.pendingResume = null;
    this.previewing = false;
    this.unsubscribe();
    this.engine.dispose();
  }

  // ---- candidate preview (spec §13, §37.9) ---------------------------------

  /**
   * Plays `previewScore` starting at `fromTick`, without touching the
   * committed score or committed-score subscription (spec §13: "candidate
   * playback in musical context"). `previewScore` is expected to be built
   * with `features/generation/preview.ts`'s `scoreWithCandidate` — a
   * candidate spliced into the current committed score, purely for this
   * call; it is never written to `score-slice`. Any playback already in
   * progress (preview or otherwise) is stopped first. Call `stopPreview()`
   * to return to the committed score.
   *
   * Preview playback and the main transport are mutually exclusive by
   * convention, not by locking: `CandidateList`'s Play-in-context/Stop
   * buttons are the only intended callers, and it calls `stopPreview()` on
   * unmount/candidate-switch so a preview never outlives its panel.
   */
  async playPreview(previewScore: Score, fromTick = 0): Promise<void> {
    const generation = ++this.previewGeneration;
    this.previewing = true;
    this.pendingResume = null;
    this.engine.stop();
    try {
      await this.engine.loadScore(previewScore);
      if (generation !== this.previewGeneration) return; // superseded by a newer playPreview()/stopPreview()
      await this.engine.play(fromTick);
    } catch (error) {
      // A failed preview load/play must not strand the engine mid-preview
      // (partial preview audio state, or simply not pointed at the
      // committed score any more) — resync it exactly like a successful
      // `stopPreview()` would, but only if this call is still current: a
      // stale/superseded call's failure must not undo a *newer*
      // `playPreview`/`stopPreview` call's already-in-progress state.
      if (generation === this.previewGeneration) {
        this.previewing = false;
        this.resyncEngineToCommittedScore();
      }
      this.reportError('Preview playback failed to start', error);
    }
  }

  /** Stops an in-progress candidate preview and reloads the committed score back into the engine. A no-op if no preview is active. */
  stopPreview(): void {
    this.previewGeneration++; // invalidate any playPreview() still in flight
    if (!this.previewing) return;
    this.previewing = false;
    this.resyncEngineToCommittedScore();
  }

  /** Stops the engine and reloads whatever `score-slice.score` currently is — the shared "return the engine to the committed score" step behind both `stopPreview()` and `playPreview()`'s failure path. */
  private resyncEngineToCommittedScore(): void {
    this.engine.stop();
    const score = this.store.getState().score;
    if (score) void this.handleScoreChange(score);
  }

  // ---- transport ---------------------------------------------------------

  togglePlay(): void {
    const { state, score } = this.store.getState();
    if (!score) return;
    if (this.previewing) {
      // Stale-preview replay guard (Task 19 review fold-in a): `previewing`
      // is only ever cleared by an explicit `stopPreview()` call, never
      // automatically when a preview simply finishes playing on its own --
      // so without this, pressing the main transport's Play button right
      // after a preview ends would resume whatever the engine still has
      // loaded (the candidate), not the committed score. Queue the resume
      // through the same `pendingResume` -> `handleScoreChange` path
      // `stopPreview()`'s own resync already drives, so the actual
      // `engine.play()` call happens only once the committed score has
      // genuinely finished (re)loading, rather than racing ahead of it by
      // calling `engine.play()` directly here.
      this.pendingResume = { tick: this.store.getState().positionTick };
      this.stopPreview();
      return;
    }
    this.pendingResume = null; // an explicit user play/pause action takes over from any queued auto-resume
    if (state === 'playing') {
      this.engine.pause();
    } else {
      this.engine.play().catch((error: unknown) => this.reportError('Playback failed to start', error));
    }
  }

  stop(): void {
    this.pendingResume = null; // an explicit user stop cancels any queued auto-resume from an in-flight reload
    this.engine.stop();
  }

  seek(tick: number): void {
    if (!this.store.getState().score) return;
    this.pendingResume = null; // an explicit user seek cancels any queued auto-resume from an in-flight reload
    this.engine.seek(Math.max(0, tick));
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
    const { score, positionTick } = this.store.getState();
    if (!score) return;
    const current = measureAt(score, positionTick);
    if (!current) return;
    this.seekToMeasure(Math.max(0, current.index - 1));
  }

  nextMeasure(): void {
    const { score, positionTick } = this.store.getState();
    if (!score) return;
    const current = measureAt(score, positionTick);
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

  // ---- internals ------------------------------------------------------------

  /**
   * Reschedules the engine after the store's `score` reference changes
   * (any edit, undo/redo, MIDI/MusicXML import, generation accept, or a
   * freshly opened project — `score-slice`'s `dispatchCommand`/`undo`/
   * `redo`/`setScore` all produce a new `Score` object). If playback was
   * in progress, this is a "stop, reload, seek back, resume" so the
   * rebuilt schedule reflects the edit cleanly rather than leaving stale
   * Transport events or stuck voices from the old score (spec §10:
   * "reschedule safely after edits").
   *
   * Resume intent is captured into `pendingResume` up front, *before*
   * `engine.stop()` runs, and only consumed (cleared + turned into
   * `engine.play(tick)`) by whichever call is still current once its
   * `loadScore` resolves — never re-derived from the store afterward. Two
   * things would otherwise go wrong for a burst of rapid score changes: (1)
   * the real engine's `stop()` synchronously flips the store's `state`/
   * `positionTick` back to `'stopped'`/`0` via the observer wiring, so a
   * second call reading the store *after* the first call's `stop()` would
   * wrongly conclude nothing was playing and silently drop the resume
   * entirely; (2) `scoreChangeGeneration`'s own doc explains why a stale
   * call must not act on an old score — but the resume it was carrying
   * still needs to reach the call that *does* end up current, which is
   * exactly what leaving `pendingResume` set (rather than clearing it) on
   * an aborted/superseded call accomplishes.
   */
  private async handleScoreChange(score: Score): Promise<void> {
    const generation = ++this.scoreChangeGeneration;

    const shouldResume = this.pendingResume !== null || this.store.getState().state === 'playing';
    if (shouldResume && !this.pendingResume) {
      this.pendingResume = { tick: this.store.getState().positionTick };
    }

    try {
      if (shouldResume) this.engine.stop();
      await this.engine.loadScore(score);
      if (generation !== this.scoreChangeGeneration) return; // superseded by a newer score change; that newer call (not this one) owns consuming pendingResume
      if (this.pendingResume) {
        const { tick } = this.pendingResume;
        this.pendingResume = null;
        await this.engine.play(tick);
      }
    } catch (error) {
      // Only clear pendingResume if this call is still the current one: a
      // stale/superseded call's failure (it already returned above if it
      // failed the generation check *before* throwing, but loadScore can
      // reject either before or interleaved with that check) must not wipe
      // out a newer, still-in-flight call's legitimately-owned resume.
      if (generation === this.scoreChangeGeneration) {
        this.pendingResume = null;
      }
      this.reportError('Failed to load the score for playback', error);
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

/** The app's single running controller, wired to the real Tone engine and the app-wide store. */
export const playbackController: PlaybackController = createPlaybackController(new TonePlaybackEngine(), useAppStore);
