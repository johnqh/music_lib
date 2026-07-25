/**
 * UI slice (spec §6, §33): view mode, theme, zoom/snap, developer settings
 * (spec §33: mock seed, id/tick overlays), dialog open-state, and toasts.
 * Pure UI/app state — no domain mutation happens here (that's always
 * `score-slice.dispatchCommand`).
 */
import type { StateCreator } from 'zustand';
import { createId } from '../../domain/score/ids.js';
import type { DurationName } from '@sudobility/music_types';
import { DEFAULT_MOCK_SEED, setMockSeed } from '../../services/generation/registry.js';
import type { AppState } from '../useAppStore.js';

export type ViewMode = 'notation' | 'piano-roll';
export type ThemeMode = 'light' | 'dark' | 'system';

export type DevSettings = {
  seed: string;
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
  // string) so the seed this panel *displays* as the default can never
  // silently disagree with the seed the registry's provider actually boots
  // with (see registry.ts's DEFAULT_MOCK_SEED doc comment).
  seed: DEFAULT_MOCK_SEED,
  showIds: false,
  showTicks: false,
  showMeasureBoundaries: false,
  showPlaybackScheduling: false,
  enableDiagnostics: false,
  enableValidationWarnings: true,
};

export type UiSlice = {
  view: ViewMode;
  themeMode: ThemeMode;
  zoom: number;
  snapGrid: DurationName;
  developerMode: boolean;
  devSettings: DevSettings;
  dialogs: Record<string, boolean>;
  toasts: Toast[];

  setView: (view: ViewMode) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setZoom: (zoom: number) => void;
  setSnapGrid: (grid: DurationName) => void;
  setDeveloperMode: (enabled: boolean) => void;
  /** Merges `patch` into `devSettings`; changing `seed` also re-seeds the generation provider registry (`services/generation/registry.ts`) so the next generate/regenerate call picks it up. */
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
  view: 'notation',
  themeMode: 'system',
  zoom: 1,
  snapGrid: 'quarter',
  developerMode: false,
  devSettings: DEFAULT_DEV_SETTINGS,
  dialogs: {},
  toasts: [],

  setView: (view) => {
    set((state) => {
      state.view = view;
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
    if (patch.seed !== undefined) setMockSeed(patch.seed);
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
