/**
 * Playback slice (spec §10, §37.3): data only. The Tone.js engine instance
 * itself lives in a module singleton in `src/services/playback/` (Task
 * 13), never here — this slice exists so the transport UI has something to
 * subscribe to, and exposes plain setters for that future engine/
 * controller to call as playback advances. No Tone/VexFlow import belongs
 * anywhere in this file.
 */
import type { StateCreator } from 'zustand';
import type { PlaybackLoadState } from '@sudobility/music_types';
import type { ScoreRange } from '../../domain/selection/types.js';
import type { AppState } from '../useAppStore.js';

export type TransportState = 'stopped' | 'playing' | 'paused';

export type PlaybackSlice = {
  /** Named `state` (not `transportState`) to match the spec's exact field name for this property. */
  state: TransportState;
  /**
   * Where the *user* is: the edit caret.
   *
   * Not where the audio is. Playback position lives on `PlaybackBus`, which is
   * what keeps a ~30Hz value out of the store — this one moves on a click, a
   * seek, an arrow key or a note entry, which is a handful of times a minute.
   *
   * Play starts from here, so "play from the caret" still needs no plumbing;
   * pause, stop and seek write the engine's final position back, so when
   * stopped the two coincide exactly as they always did.
   */
  caretTick: number;
  loopRange: ScoreRange | null;
  tempoMultiplier: number;
  metronome: boolean;
  masterVolume: number;
  /**
   * How far the engine is from being able to make a sound.
   *
   * The soundfont engine has tens of megabytes to fetch and several seconds of
   * synth setup before the first note, all on the first press of Play. Without
   * this in the store the transport just looks broken for that whole time.
   */
  synthLoad: PlaybackLoadState;

  setPlaybackState: (state: TransportState) => void;
  setSynthLoad: (state: PlaybackLoadState) => void;
  setCaretTick: (tick: number) => void;
  setLoopRange: (range: ScoreRange | null) => void;
  setTempoMultiplier: (multiplier: number) => void;
  setMetronome: (enabled: boolean) => void;
  setMasterVolume: (volume: number) => void;
};

export const createPlaybackSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  PlaybackSlice
> = set => ({
  state: 'stopped',
  caretTick: 0,
  loopRange: null,
  tempoMultiplier: 1,
  metronome: false,
  synthLoad: { status: 'idle' },
  masterVolume: 1,

  setPlaybackState: state => {
    set(draft => {
      draft.state = state;
    });
  },
  setSynthLoad: state => {
    set(draft => {
      draft.synthLoad = state;
    });
  },
  setCaretTick: tick => {
    set(draft => {
      draft.caretTick = tick;
    });
  },
  setLoopRange: range => {
    set(draft => {
      draft.loopRange = range;
    });
  },
  setTempoMultiplier: multiplier => {
    set(draft => {
      draft.tempoMultiplier = multiplier;
    });
  },
  setMetronome: enabled => {
    set(draft => {
      draft.metronome = enabled;
    });
  },
  setMasterVolume: volume => {
    set(draft => {
      draft.masterVolume = volume;
    });
  },
});
