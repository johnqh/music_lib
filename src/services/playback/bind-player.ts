/**
 * Binds one editing store to a player.
 *
 * The store-generic core of music_lib's `PlaybackAdapter`. That adapter binds
 * the web app's single application store; the native app has a store per
 * document and wrote a smaller binder of its own (`useTransport`), which
 * mirrored the transport state and loaded scores and did nothing else — no
 * loop, no bar stepping, no clearing the selection on play, no visible tracks
 * pushed to the player, no error report. Those are rules about how editing and
 * playback meet, not about either store's shape, so they are stated once.
 *
 * The split with the player is unchanged: the player exposes primitives
 * (`play`, `setLoop`, `setVisibleTracks`), and this composes the score-,
 * selection- and caret-aware operations out of them. The caret is the shared
 * `MusicPosition`, which the player follows by itself, so seeking is a move of
 * that position and nothing else.
 *
 * **Here rather than in music_editing**, where it began: binding a player is
 * not editing. Written there, it had to type the player structurally — editing
 * may not depend on music_player — which meant a hand-kept copy of the
 * transport's methods and a compile-time check that the copy still matched.
 * This package depends on music_player already, so the binder takes the
 * player's own `IMusicPlayer`.
 */
import {
  getMusicPosition,
  getMusicPositionSource,
  scoreEndTick,
  selectionToRange,
} from '@sudobility/music_types';
import type {
  PlayerFailure,
  Score,
  ScoreRange,
  TransportSettings,
} from '@sudobility/music_types';
import type { IMusicPlayer } from '@sudobility/music_player/core';
import { selectVisibleTrackIds } from '@sudobility/music_editing';
import type { EditingState, EditingStoreApi } from '@sudobility/music_editing';

/**
 * What a store that has never been bound shows for the transport settings
 * (`TransportSettings`, in music_types). The binder writes them into whichever
 * store it is given; a store that wants to render them before the first write
 * seeds these.
 */
export const TRANSPORT_SETTINGS_DEFAULTS: TransportSettings = {
  loopRange: null,
  tempoMultiplier: 1,
  metronome: false,
  masterVolume: 1,
  synthLoad: { status: 'idle' },
};

export type BindPlayerOptions = {
  onError?: (failure: PlayerFailure, error: unknown) => void;
};

export type PlayerBinding = {
  /** Plays from the caret, clearing the selection; pauses if already playing. */
  togglePlay(): Promise<void>;
  pause(): void;
  stop(): void;
  /** Moves the caret to a written tick, floored at 0. */
  seek(tick: number): void;
  seekToMeasure(measureIndex: number): void;
  goToStart(): void;
  previousMeasure(): void;
  nextMeasure(): void;
  /** Clears an active loop, or loops the selection — else the whole score. */
  toggleLoop(): void;
  setLoopFromSelection(): void;
  clearLoop(): void;
  setTempoMultiplier(multiplier: number): void;
  setMetronome(enabled: boolean): void;
  setMasterVolume(volume: number): void;
  /**
   * Stops listening to both sides, pausing this store's playback if it is the
   * one playing. Does not dispose the player: whoever made it owns it.
   */
  unbind(): void;
};

/**
 * The score each player last loaded, whichever binding loaded it.
 *
 * A player is app-wide and a binding is not. The published page binds a store
 * of its own while the editor's binding stays alive beneath it — a pushed
 * screen on the native app, the app-wide adapter on the web — and a binding
 * loads only when its own score changes. So returning to the editor found the
 * published piece still in the player, the editor's binding saw nothing to
 * reload, and Play played somebody else's music. Keyed on the player, so every
 * binding to it reads the same answer; weakly, so a disposed player is not
 * kept alive by it.
 */
const loadedScores = new WeakMap<IMusicPlayer, Score>();

/** The measure a tick falls in, on the first track — every track shares the grid. */
function measureAt(score: Score, tick: number) {
  const measures = score.tracks[0]?.measures ?? [];
  if (measures.length === 0) return null;
  return (
    measures.find(
      m => tick >= m.startTick && tick < m.startTick + m.durationTicks
    ) ?? measures[measures.length - 1]!
  );
}

export function bindPlayer<T extends EditingState & Partial<TransportSettings>>(
  player: IMusicPlayer,
  store: EditingStoreApi<T>,
  options: BindPlayerOptions = {}
): PlayerBinding {
  const report = (failure: PlayerFailure, error: unknown) =>
    options.onError?.(failure, error);

  const write = (update: (draft: T) => void) => store.setState(update);

  /** Whether the player holds this store's score, rather than another binding's. */
  const ownsPlayer = (): boolean => {
    const score = store.getState().score;
    return score !== null && loadedScores.get(player) === score;
  };

  const load = async (score: Score): Promise<void> => {
    // Recorded before the await: from this moment the player is this score's,
    // and a binding asking during the load must not start another.
    loadedScores.set(player, score);
    try {
      await player.load(score, {
        visibleTrackIds: selectVisibleTrackIds(store.getState()),
      });
    } catch (error) {
      report('scoreLoadFailed', error);
    }
  };

  const offPlayer = [
    player.onTransport(state =>
      write(draft => {
        // Only the store whose score is sounding is playing. Another binding's
        // playback must not lock this store's editing as though it were.
        draft.state = ownsPlayer() ? state : 'stopped';
      })
    ),
    // Low-frequency and store-shaped: it reports per percent and behaves like
    // ordinary state, unlike position and the sounding set.
    player.onLoadState(state =>
      write(draft => {
        draft.synthLoad = state;
      })
    ),
  ];

  let lastScore: Score | null = store.getState().score;
  let lastVisible = store.getState().visibleTrackIds;
  if (lastScore) void load(lastScore);

  const offStore = store.subscribe(state => {
    if (state.score !== lastScore) {
      lastScore = state.score;
      // A new score is loaded with the visible tracks as they are now, so the
      // visible-track check below has nothing to add.
      lastVisible = state.visibleTrackIds;
      if (lastScore) void load(lastScore);
      return;
    }
    // Hiding a track silences it — pushed straight to the player rather than
    // reloading, since muting is a per-channel gain and takes effect
    // mid-playback without rescheduling a note.
    if (state.visibleTrackIds !== lastVisible) {
      lastVisible = state.visibleTrackIds;
      // The player is playing another binding's score: its channels are not
      // this score's tracks. The next load carries the visible tracks anyway.
      if (ownsPlayer()) player.setVisibleTracks(selectVisibleTrackIds(state));
    }
  });

  const seek = (tick: number): void => {
    if (!store.getState().score) return;
    // The player follows the one position of its own accord; telling it as
    // well would be two writes of one number.
    getMusicPositionSource().moveTo(Math.max(0, tick));
  };

  const seekToMeasure = (measureIndex: number): void => {
    const measure = store
      .getState()
      .score?.tracks[0]?.measures.find(m => m.index === measureIndex);
    if (measure) seek(measure.startTick);
  };

  const stepMeasure = (delta: 1 | -1): void => {
    const score = store.getState().score;
    if (!score) return;
    const current = measureAt(score, getMusicPosition().reportedTick);
    if (!current) return;
    const last = score.tracks[0]!.measures.length - 1;
    seekToMeasure(Math.max(0, Math.min(last, current.index + delta)));
  };

  const setLoop = (range: ScoreRange | null): void => {
    write(draft => {
      draft.loopRange = range;
    });
    player.setLoop(range);
  };

  return {
    async togglePlay() {
      const { state, score } = store.getState();
      if (!score) return;
      if (state === 'playing') {
        player.pause();
        return;
      }
      // Only on the way into playing: pausing to edit keeps what you had
      // selected. Playing from the caret needs nothing — the caret is the
      // position the player resumes from.
      store.getState().clearSelection();
      // Another binding may have loaded the player since this score was: put
      // this one back first, so Play plays what this store shows.
      if (!ownsPlayer()) await load(score);
      try {
        await player.play();
      } catch (error) {
        report('playbackFailed', error);
      }
    },
    pause: () => player.pause(),
    stop: () => player.stop(),
    seek,
    seekToMeasure,
    goToStart: () => seek(0),
    previousMeasure: () => stepMeasure(-1),
    nextMeasure: () => stepMeasure(1),
    toggleLoop() {
      const { score, selection, loopRange } = store.getState();
      if (loopRange) {
        setLoop(null);
        return;
      }
      if (!score) return;
      setLoop(
        selectionToRange(score, selection) ?? {
          startTick: 0,
          endTick: scoreEndTick(score),
          trackIds: [],
        }
      );
    },
    setLoopFromSelection() {
      const { score, selection } = store.getState();
      if (!score) return;
      const range = selectionToRange(score, selection);
      if (range) setLoop(range);
    },
    clearLoop: () => setLoop(null),
    setTempoMultiplier(multiplier) {
      write(draft => {
        draft.tempoMultiplier = multiplier;
      });
      player.setTempoMultiplier(multiplier);
    },
    setMetronome(enabled) {
      write(draft => {
        draft.metronome = enabled;
      });
      player.setMetronome(enabled);
    },
    setMasterVolume(volume) {
      write(draft => {
        draft.masterVolume = volume;
      });
      player.setMasterVolume(volume);
    },
    unbind() {
      offStore();
      for (const off of offPlayer) off();
      /*
        Music this binding started stops with it. A binding ends when its
        screen does — a published page closed, a tab put behind another — and
        playback carrying on under a screen that no longer shows that score is
        a transport nobody can reach. Paused rather than stopped, so the caret
        stays where the music was; and only when this store's score is the one
        playing, so unbinding never interrupts another binding's playback.
        After the listeners are gone, so the pause is not mirrored into a store
        that is no longer bound.
      */
      if (store.getState().state === 'playing' && ownsPlayer()) {
        player.pause();
        write(draft => {
          draft.state = 'paused';
        });
      }
    },
  };
}
