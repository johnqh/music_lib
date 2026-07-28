/**
 * UI slice (spec §6, §33): active track, theme, zoom/snap, developer settings
 * (spec §33: mock seed, id/tick overlays), dialog open-state, and toasts.
 * Pure UI/app state — no domain mutation happens here (that's always
 * `score-slice.dispatchCommand`).
 *
 * There is no view mode: notation and the piano roll are shown at the same
 * time, so nothing switches between them.
 */
import type { StateCreator } from 'zustand';
import { createId } from '../../domain/score/ids.js';
import type { DurationName, UUID } from '@sudobility/music_types';
import type { AppState } from '../useAppStore.js';

export type ThemeMode = 'light' | 'dark' | 'system';

export type DevSettings = {
  showIds: boolean;
  showTicks: boolean;
  /** Spec §33: "show measure boundaries". */
  showMeasureBoundaries: boolean;
  /** Spec §33: "show playback scheduling data". */
  showPlaybackScheduling: boolean;
  /** Spec §33: "enable generation diagnostics". */
  enableDiagnostics: boolean;
  /** Spec §33: "enable validation warnings" (warning-severity issues, in addition to errors). */
  enableValidationWarnings: boolean;
};

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';
/** An optional action button (spec §28: "retry actions where appropriate"), e.g. "Retry" on a failed import/save toast. */
export type ToastAction = { label: string; onClick: () => void };
export type Toast = { id: string; message: string; severity: ToastSeverity; action?: ToastAction };

const DEFAULT_DEV_SETTINGS: DevSettings = {
  // Shares registry.ts's DEFAULT_MOCK_SEED (rather than a locally hardcoded
  // with (see registry.ts's DEFAULT_MOCK_SEED doc comment).
  showIds: false,
  showTicks: false,
  showMeasureBoundaries: false,
  showPlaybackScheduling: false,
  enableDiagnostics: false,
  enableValidationWarnings: true,
};

export type UiSlice = {
  /**
   * The track the caret, the piano roll, and the notation's active-stave
   * coloring follow. `null` means "not explicitly chosen" — read it through
   * `selectActiveTrackId`, which resolves that to the score's first track.
   *
   * Deliberately NOT persisted: a track id is meaningful only inside one
   * project, so a device-level preference would carry a dead id across
   * projects. It resets to "first track" on load, which is the default anyway.
   */
  activeTrackId: UUID | null;
  themeMode: ThemeMode;
  zoom: number;
  snapGrid: DurationName;
  developerMode: boolean;
  devSettings: DevSettings;
  dialogs: Record<string, boolean>;
  toasts: Toast[];

  setActiveTrack: (trackId: UUID | null) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setZoom: (zoom: number) => void;
  setSnapGrid: (grid: DurationName) => void;
  setDeveloperMode: (enabled: boolean) => void;
  /** Merges `patch` into `devSettings`. */
  setDevSettings: (patch: Partial<DevSettings>) => void;
  openDialog: (id: string) => void;
  closeDialog: (id: string) => void;
  toggleDialog: (id: string) => void;
  /** Enqueues a toast and returns its generated id (so a caller can `dismissToast` it early, e.g. on an "undo" action inside the toast itself). */
  pushToast: (toast: { message: string; severity?: ToastSeverity; action?: ToastAction }) => string;
  dismissToast: (id: string) => void;
};

export const createUiSlice: StateCreator<AppState, [['zustand/immer', never]], [], UiSlice> = (
  set,
) => ({
  activeTrackId: null,
  themeMode: 'system',
  zoom: 1,
  snapGrid: 'quarter',
  developerMode: false,
  devSettings: DEFAULT_DEV_SETTINGS,
  dialogs: {},
  toasts: [],

  setActiveTrack: (trackId) => {
    set((state) => {
      state.activeTrackId = trackId;
    });
  },
  setThemeMode: (mode) => {
    set((state) => {
      state.themeMode = mode;
    });
  },
  setZoom: (zoom) => {
    set((state) => {
      state.zoom = zoom;
    });
  },
  setSnapGrid: (grid) => {
    set((state) => {
      state.snapGrid = grid;
    });
  },
  setDeveloperMode: (enabled) => {
    set((state) => {
      state.developerMode = enabled;
    });
  },
  setDevSettings: (patch) => {
    set((state) => {
      Object.assign(state.devSettings, patch);
    });
  },
  openDialog: (id) => {
    set((state) => {
      state.dialogs[id] = true;
    });
  },
  closeDialog: (id) => {
    set((state) => {
      state.dialogs[id] = false;
    });
  },
  toggleDialog: (id) => {
    set((state) => {
      state.dialogs[id] = !state.dialogs[id];
    });
  },
  pushToast: (toast) => {
    const id = createId();
    set((state) => {
      state.toasts.push({
        id,
        message: toast.message,
        severity: toast.severity ?? 'info',
        ...(toast.action ? { action: toast.action } : {}),
      });
    });
    return id;
  },
  dismissToast: (id) => {
    set((state) => {
      state.toasts = state.toasts.filter((t) => t.id !== id);
    });
  },
});
