/**
 * Playback slice (spec §10, §37.3): data only. The Tone.js engine instance
 * itself lives in a module singleton in `src/services/playback/` (Task
 * 13), never here — this slice exists so the transport UI has something to
 * subscribe to, and exposes plain setters for that future engine/
 * controller to call as playback advances. No Tone/VexFlow import belongs
 * anywhere in this file.
 */
import type { StateCreator } from 'zustand';
import type { ScoreRange } from '../../domain/selection/types';
import type { AppState } from '../useAppStore';

export type TransportState = 'stopped' | 'playing' | 'paused';

export type PlaybackSlice = {
  /** Named `state` (not `transportState`) to match the spec's exact field name for this property. */
  state: TransportState;
  positionTick: number;
  activeNoteIds: string[];
  loopRange: ScoreRange | null;
  tempoMultiplier: number;
  metronome: boolean;
  masterVolume: number;

  setPlaybackState: (state: TransportState) => void;
  setPositionTick: (tick: number) => void;
  setActiveNoteIds: (ids: string[]) => void;
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
> = (set) => ({
  state: 'stopped',
  positionTick: 0,
  activeNoteIds: [],
  loopRange: null,
  tempoMultiplier: 1,
  metronome: false,
  masterVolume: 1,

  setPlaybackState: (state) => {
    set((draft) => {
      draft.state = state;
    });
  },
  setPositionTick: (tick) => {
    set((draft) => {
      draft.positionTick = tick;
    });
  },
  setActiveNoteIds: (ids) => {
    set((draft) => {
      draft.activeNoteIds = ids;
    });
  },
  setLoopRange: (range) => {
    set((draft) => {
      draft.loopRange = range;
    });
  },
  setTempoMultiplier: (multiplier) => {
    set((draft) => {
      draft.tempoMultiplier = multiplier;
    });
  },
  setMetronome: (enabled) => {
    set((draft) => {
      draft.metronome = enabled;
    });
  },
  setMasterVolume: (volume) => {
    set((draft) => {
      draft.masterVolume = volume;
    });
  },
});
