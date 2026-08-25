/**
 * Binds the app store to the player.
 *
 * This is what is left of `PlaybackController` once the sound moved to
 * `@sudobility/music_player`. What stayed is everything that reads or writes
 * editing state — the score, the visible tracks, the selection and the caret —
 * because those are not playback's to own, and a copy of the caret inside the
 * player would be a second thing that can disagree with the first.
 *
 * So the split is: the player exposes primitives (`play`, `seek`, `setLoop`),
 * and this composes the score- and selection-aware operations out of them.
 */
import { scoreEndTick, selectionToRange } from '@sudobility/music_types';
import {
  getMusicPosition,
  getMusicPositionSource,
} from '@sudobility/music_types';
import type {
  Score,
  ScoreRange,
  SoundingNote,
  TransportPlaybackState,
} from '@sudobility/music_types';
import type { IMusicPlayer } from '@sudobility/music_player/core';
import { getMusicPlayer } from '@sudobility/music_player/core';
import { libraryMessage } from '../messages.js';
import { selectVisibleTrackIds } from '@sudobility/music_editing';
import { useAppStore } from '../../store/useAppStore.js';
import type { createAppStore } from '../../store/useAppStore.js';

/** The store shape this module operates on: the same type `useAppStore`/`createAppStore()` produce. */
export type PlaybackStoreApi = ReturnType<typeof createAppStore>;

/** The measure a domain tick falls in, on the score's first track (every track shares the measure grid). */
function measureAt(score: Score, tick: number) {
  const track = score.tracks[0];
  if (!track || track.measures.length === 0) return null;
  return (
    track.measures.find(
      m => tick >= m.startTick && tick < m.startTick + m.durationTicks
    ) ?? track.measures[track.measures.length - 1]
  );
}

export class PlaybackAdapter {
  private readonly unsubscribe: () => void;
  private readonly unsubscribePlayer: Array<() => void> = [];

  /**
   * The last tick the player *reported*, which is not the same number as
   * `IMusicPosition.tick`.
   *
   * That one is dead-reckoned forward between reports so the caret moves
   * smoothly; this one is the last authoritative value. Committing the smoothed
   * projection to the caret on pause would leave it a few ticks past where the
   * audio actually stopped.
   */

  constructor(
    private readonly player: IMusicPlayer,
    private readonly store: PlaybackStoreApi
  ) {
    this.unsubscribePlayer.push(
      /*
        No position subscription, and no caret to commit on stop.

        This used to keep `lastPositionTick` and write it into the store's
        caret whenever the transport stopped, so that "play from the caret"
        would resume where the music left off. There is one position now: the
        engine reports into it and the caret *is* it, so the two coincide by
        construction rather than by this class copying one into the other.
      */
      player.onTransport(state => {
        this.store.getState().setPlaybackState(state);
      }),
      // Low-frequency and store-shaped: it reports per percent and behaves like
      // ordinary React state, unlike position and the sounding set.
      player.onLoadState(state => this.store.getState().setSynthLoad(state))
    );

    let lastVisibleTrackIds: readonly string[] | null =
      this.store.getState().visibleTrackIds;
    let lastScore: Score | null = this.store.getState().score;
    if (lastScore) void this.load(lastScore);

    this.unsubscribe = this.store.subscribe(state => {
      if (state.score !== lastScore) {
        lastScore = state.score;
        if (lastScore) void this.load(lastScore);
        return;
      }
      // Hiding a track silences it. Pushed straight to the player rather than
      // reloading: muting is a per-channel gain decision, so it takes effect
      // mid-playback without rescheduling a note.
      if (state.visibleTrackIds !== lastVisibleTrackIds) {
        lastVisibleTrackIds = state.visibleTrackIds;
        this.player.setVisibleTracks(selectVisibleTrackIds(state));
      }
    });
  }

  /**
   * Loads a score into the player, reporting a failure rather than swallowing
   * it.
   *
   * The translation lives here, not in music_player: the message a user sees is
   * localized, and that package carries no copy.
   */
  private async load(score: Score): Promise<void> {
    try {
      await this.player.load(score, {
        visibleTrackIds: selectVisibleTrackIds(this.store.getState()),
      });
    } catch (error) {
      this.reportError(libraryMessage('scoreLoadFailed'), error);
    }
  }

  dispose(): void {
    this.unsubscribe();
    for (const off of this.unsubscribePlayer) off();
    this.player.dispose();
  }

  // ---- transport ---------------------------------------------------------

  async togglePlay(): Promise<void> {
    const { state, score } = this.store.getState();
    if (!score) return;
    if (state === 'playing') {
      this.player.pause();
      return;
    }
    // Starting playback deselects. Only on the ->playing transition: `pause()`
    // and `stop()` deliberately leave the selection alone, so pausing to edit
    // keeps what you had selected.
    //
    // "Play from the caret" needs no code here — the player resumes from the
    // transport position, and a caret seek is exactly what set it.
    this.store.getState().clearSelection();
    try {
      await this.player.play();
    } catch (error) {
      this.reportError(libraryMessage('playbackFailed'), error);
    }
  }

  stop(): void {
    this.player.stop();
  }

  /**
   * Seeks to a *written* position.
   *
   * The caret keeps the score tick, because that is where the reader is
   * looking; the player is given the same tick and translates it to the first
   * performance of it, which is what "play from here" means to somebody
   * reading the page — the first time through, not the repeat.
   */
  seek(tick: number): void {
    if (!this.store.getState().score) return;
    // Moving the position is the whole of it: the player follows moves of its
    // own accord, so telling it as well would be two writes of one number.
    getMusicPositionSource().moveTo(Math.max(0, tick));
  }

  seekToMeasure(measureIndex: number): void {
    const score = this.store.getState().score;
    const measure = score?.tracks[0]?.measures.find(
      m => m.index === measureIndex
    );
    if (!measure) return;
    this.seek(measure.startTick);
  }

  goToStart(): void {
    this.seek(0);
  }

  previousMeasure(): void {
    const { score } = this.store.getState();
    if (!score) return;
    const current = measureAt(score, getMusicPosition().reportedTick);
    if (!current) return;
    this.seekToMeasure(Math.max(0, current.index - 1));
  }

  nextMeasure(): void {
    const { score } = this.store.getState();
    if (!score) return;
    const current = measureAt(score, getMusicPosition().reportedTick);
    if (!current) return;
    const lastIndex = score.tracks[0].measures.length - 1;
    this.seekToMeasure(Math.min(lastIndex, current.index + 1));
  }

  // ---- loop ---------------------------------------------------------------

  private setLoop(range: ScoreRange | null): void {
    this.store.getState().setLoopRange(range);
    this.player.setLoop(range);
  }

  /** Sets the loop range from the current selection; a no-op if the selection has no resolvable tick extent. */
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

  /** The transport's single loop toggle: clears an active loop, or sets one (from the selection, falling back to the whole score). */
  toggleLoop(): void {
    const { score, loopRange, selection } = this.store.getState();
    if (loopRange) {
      this.clearLoop();
      return;
    }
    if (!score) return;
    const range = selectionToRange(score, selection) ?? {
      startTick: 0,
      endTick: scoreEndTick(score),
      trackIds: [],
    };
    this.setLoop(range);
  }

  // ---- tempo / metronome / volume ------------------------------------------

  setTempoMultiplier(multiplier: number): void {
    this.store.getState().setTempoMultiplier(multiplier);
    this.player.setTempoMultiplier(multiplier);
  }

  setMetronome(enabled: boolean): void {
    this.store.getState().setMetronome(enabled);
    this.player.setMetronome(enabled);
  }

  setMasterVolume(volume: number): void {
    this.store.getState().setMasterVolume(volume);
    this.player.setMasterVolume(volume);
  }

  /**
   * Sounds a pitch for as long as it is held — auditioning a key while editing.
   *
   * Touches no store state on purpose: this is not transport playback, so it
   * must not move the caret, set the playing/paused state, or appear in the
   * active-note highlighting that follows the score.
   */
  noteOn(midi: number, program: number, isPercussion = false): void {
    this.player.noteOn(midi, program, isPercussion);
  }

  noteOff(midi: number): void {
    this.player.noteOff(midi);
  }

  // ---- subscriptions, forwarded ---------------------------------------------

  /**
   * The player's bus, passed straight through.
   *
   * Not a delegating view: there is one bus and the player owns it. Two would
   * be two answers to "what is sounding", which is the disagreement the single
   * source of truth exists to prevent.
   */
  get bus() {
    return this.player.bus;
  }

  onPosition(fn: (tick: number) => void): () => void {
    return this.player.onPosition(fn);
  }

  onSounding(fn: (notes: readonly SoundingNote[]) => void): () => void {
    return this.player.onSounding(fn);
  }

  onTransport(fn: (state: TransportPlaybackState) => void): () => void {
    return this.player.onTransport(fn);
  }

  /** Where playback last reported it was, in score ticks. Read through to the one position. */
  get positionTick(): number {
    return getMusicPosition().reportedTick;
  }

  reportError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.store
      .getState()
      .pushToast({ message: `${message}: ${detail}`, severity: 'error' });
  }
}

export function createPlaybackAdapter(
  player: IMusicPlayer,
  store: PlaybackStoreApi
): PlaybackAdapter {
  return new PlaybackAdapter(player, store);
}

let singleton: PlaybackAdapter | null = null;

function realAdapter(): PlaybackAdapter {
  if (!singleton) {
    // The player comes from its own singleton, not from here: this file must
    // not know which platform it is running on.
    singleton = createPlaybackAdapter(getMusicPlayer(), useAppStore);
  }
  return singleton;
}

/**
 * The app's single running adapter, wired to the registered player and the
 * app-wide store — constructed lazily on first property access (a Proxy) so
 * importing this module neither builds an audio graph nor requires
 * `initializeAppStore`/`initializeMusicPlayer` to have run yet.
 *
 * Still named `playbackController` as well, so the app's call sites can move in
 * their own change rather than all at once.
 */
export const playbackAdapter: PlaybackAdapter = new Proxy(
  {} as PlaybackAdapter,
  {
    get(_target, prop) {
      const adapter = realAdapter();
      const value = Reflect.get(adapter, prop, adapter);
      return typeof value === 'function' ? value.bind(adapter) : value;
    },
  }
);

/** @deprecated Use `playbackAdapter`; kept so app call sites can move separately. */
export const playbackController = playbackAdapter;

/** Test-only: drops the lazily-built singleton so suites cannot leak into each other. */
export function resetPlaybackAdapter(): void {
  singleton = null;
}
