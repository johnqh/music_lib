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
 * and the score- and selection-aware operations are composed out of them.
 *
 * **That composition is music_editing's `bindPlayer` now**, and this class is
 * a thin shell over it. The native app has a store per document and had
 * written a smaller binder of its own, which mirrored the transport and loaded
 * scores and did nothing else — no loop, no bar stepping, no clearing the
 * selection on play, no visible tracks pushed to the player. Those are rules
 * about how editing and playback meet, not about the web app's store, so they
 * are stated once there and bound here. What stays here is what only this
 * package has: the player's disposal, auditioning, the bus and position
 * pass-throughs, the localized error toast, and the lazy app-wide singleton.
 */
import { getMusicPosition } from '@sudobility/music_types';
import type {
  SoundingNote,
  TransportPlaybackState,
} from '@sudobility/music_types';
import type { IMusicPlayer } from '@sudobility/music_player/core';
import { getMusicPlayer } from '@sudobility/music_player/core';
import { bindPlayer } from '@sudobility/music_editing';
import type {
  BindablePlayer,
  PlayerBinding,
  PlayerFailure,
} from '@sudobility/music_editing';
import { libraryMessage } from '../messages.js';
import { useAppStore } from '../../store/useAppStore.js';
import type { createAppStore } from '../../store/useAppStore.js';

/** The store shape this module operates on: the same type `useAppStore`/`createAppStore()` produce. */
export type PlaybackStoreApi = ReturnType<typeof createAppStore>;

/*
  Compile-time proof that music_player's interface is what the binder binds.
  music_editing may not import music_player, so it declares the methods it
  uses structurally; if either side moves, this stops compiling here rather
  than a host finding out at runtime.
*/
const playerIsBindable: IMusicPlayer extends BindablePlayer ? true : false =
  true;
void playerIsBindable;

export class PlaybackAdapter {
  private readonly binding: PlayerBinding;

  constructor(
    private readonly player: IMusicPlayer,
    private readonly store: PlaybackStoreApi
  ) {
    /*
      No position subscription, and no caret to commit on stop.

      There is one position: the engine reports into it and the caret *is* it,
      so "play from the caret" needs nothing copied from one to the other.
    */
    this.binding = bindPlayer(player, store, {
      // The translation lives here, not in music_editing or music_player: the
      // message a user sees is localized, and neither of those carries copy.
      onError: (failure: PlayerFailure, error: unknown) =>
        this.reportError(libraryMessage(failure), error),
    });
  }

  dispose(): void {
    this.binding.unbind();
    this.player.dispose();
  }

  // ---- transport ---------------------------------------------------------

  /** Plays from the caret, clearing the selection; pauses if already playing. */
  togglePlay(): Promise<void> {
    return this.binding.togglePlay();
  }

  stop(): void {
    this.binding.stop();
  }

  /**
   * Seeks to a *written* position.
   *
   * The caret keeps the score tick, because that is where the reader is
   * looking; the player follows the one position and translates it to the
   * first performance of that tick.
   */
  seek(tick: number): void {
    this.binding.seek(tick);
  }

  seekToMeasure(measureIndex: number): void {
    this.binding.seekToMeasure(measureIndex);
  }

  goToStart(): void {
    this.binding.goToStart();
  }

  previousMeasure(): void {
    this.binding.previousMeasure();
  }

  nextMeasure(): void {
    this.binding.nextMeasure();
  }

  // ---- loop ---------------------------------------------------------------

  /** Sets the loop range from the current selection; a no-op if the selection has no resolvable tick extent. */
  setLoopFromSelection(): void {
    this.binding.setLoopFromSelection();
  }

  clearLoop(): void {
    this.binding.clearLoop();
  }

  /** The transport's single loop toggle: clears an active loop, or sets one (from the selection, falling back to the whole score). */
  toggleLoop(): void {
    this.binding.toggleLoop();
  }

  // ---- tempo / metronome / volume ------------------------------------------

  setTempoMultiplier(multiplier: number): void {
    this.binding.setTempoMultiplier(multiplier);
  }

  setMetronome(enabled: boolean): void {
    this.binding.setMetronome(enabled);
  }

  setMasterVolume(volume: number): void {
    this.binding.setMasterVolume(volume);
  }

  /**
   * How long the host's canvas takes to draw a change of lit notes; the player
   * publishes them that far ahead. Not stored: it is a measurement of this
   * machine, not a setting anybody chose.
   */
  setSoundingRenderDelay(seconds: number): void {
    this.player.setSoundingRenderDelay(seconds);
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
