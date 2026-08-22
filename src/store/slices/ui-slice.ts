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
import { createId } from '@sudobility/music_types';
import type { DurationName, UUID } from '@sudobility/music_types';
import type { AppState } from '../useAppStore.js';

export type ThemeMode = 'light' | 'dark' | 'system';

/** Whether notation shows what the score sounds, or what each player reads. */
export type PitchDisplay = 'concert' | 'written';

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
export type Toast = {
  id: string;
  message: string;
  severity: ToastSeverity;
  action?: ToastAction;
};

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

/**
 * What happens to music already at the caret when a new note is written.
 *
 * `insert` shifts the active track's later notes out of the way, `replace`
 * overwrites them, `stack` joins them as a chord. Deliberately NOT about
 * whether one gesture makes a chord — keys held together are one chord in
 * every mode, because that is what playing them means.
 */
export type EditMode = 'insert' | 'replace' | 'stack';

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
  /**
   * Whether a click on a stave writes a note instead of moving the caret.
   *
   * Off by default, because the caret is how everything else is aimed —
   * selection ranges, insertion, "play from here". A mode rather than a
   * permanent behaviour for the same reason every notation editor makes it
   * one: clicking to place a note and clicking to put the cursor somewhere are
   * both things people need, and they cannot share a gesture.
   */
  noteInput: boolean;

  activeTrackId: UUID | null;

  /**
   * The tracks to draw, or `null` for "all of them".
   *
   * `null` rather than a filled-in array of every id, because that is what
   * distinguishes "this project has never hidden anything" from "somebody
   * ticked every box" — the first needs nothing persisted and stays correct
   * when a track is added, the second would go stale the moment one was.
   *
   * Unlike `activeTrackId` this IS persisted, per project, through
   * `ProjectUiPrefs.visibleTrackIds` — a project-scoped preference, not a
   * device-level one. Read it through `selectVisibleTrackIds`, which resolves
   * it against the score and guarantees a non-empty result.
   */
  visibleTrackIds: string[] | null;

  themeMode: ThemeMode;
  zoom: number;
  snapGrid: DurationName;

  /**
   * Whether notation shows sounding pitch or each player's written pitch.
   *
   * A lens on notation only: the store always holds sounding pitch, and
   * playback, MIDI export and printing ignore this entirely.
   *
   * Persisted, unlike `editMode`: it is how this person likes to work, and it
   * means the same thing in every project.
   */
  pitchDisplay: PitchDisplay;

  /**
   * What writing a note does to music already at the caret.
   *
   * Lives here rather than in the editor because everything that writes notes
   * — the toolbar, the piano keyboard, paste — sits in different subtrees and
   * must agree.
   *
   * Not persisted: it is how you are editing right now, not a property of the
   * piece, and saving it would queue a write on every toggle.
   */
  editMode: EditMode;

  /**
   * Which voice new notes are written into, 0-based.
   *
   * Two voices on one stave is how a part carries independent lines — a melody
   * over a held bass, stems up against stems down. The model has always
   * supported it (`ensureVoiceAtIndex` creates the voice on demand, and the
   * renderer formats each voice group separately); nothing could choose one.
   *
   * Not persisted, and not per-track: it is where you are writing right now.
   */
  activeVoiceIndex: number;

  developerMode: boolean;
  devSettings: DevSettings;
  dialogs: Record<string, boolean>;
  toasts: Toast[];

  setActiveTrack: (trackId: UUID | null) => void;
  setNoteInput: (on: boolean) => void;

  /**
   * Sets which tracks are drawn, and marks the project dirty so the choice
   * persists on the next autosave.
   *
   * An empty list is refused rather than stored: it would leave a blank page
   * with no control left to click to get back. The UI disables the last
   * remaining checkbox so the rule is visible before it is hit, but it belongs
   * here, because the UI is not the only caller.
   */
  setVisibleTracks: (trackIds: string[]) => void;

  setThemeMode: (mode: ThemeMode) => void;
  setZoom: (zoom: number) => void;
  setSnapGrid: (grid: DurationName) => void;
  setPitchDisplay: (display: PitchDisplay) => void;
  setEditMode: (mode: EditMode) => void;
  setActiveVoice: (voiceIndex: number) => void;
  setDeveloperMode: (enabled: boolean) => void;
  /** Merges `patch` into `devSettings`. */
  setDevSettings: (patch: Partial<DevSettings>) => void;
  openDialog: (id: string) => void;
  closeDialog: (id: string) => void;
  toggleDialog: (id: string) => void;
  /** Enqueues a toast and returns its generated id (so a caller can `dismissToast` it early, e.g. on an "undo" action inside the toast itself). */
  pushToast: (toast: {
    message: string;
    severity?: ToastSeverity;
    action?: ToastAction;
  }) => string;
  dismissToast: (id: string) => void;
};

export const createUiSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  UiSlice
> = (set, get) => ({
  noteInput: false,
  activeTrackId: null,
  visibleTrackIds: null,
  themeMode: 'system',
  zoom: 1,
  snapGrid: 'quarter',
  pitchDisplay: 'concert',
  editMode: 'replace',
  activeVoiceIndex: 0,
  developerMode: false,
  devSettings: DEFAULT_DEV_SETTINGS,
  dialogs: {},
  toasts: [],

  setNoteInput: on => {
    set(state => {
      state.noteInput = on;
    });
  },

  setActiveTrack: trackId => {
    let revealed = false;
    set(state => {
      state.activeTrackId = trackId;
      // Choosing a track you cannot see and having nothing happen is not a
      // defensible outcome, so selecting reveals.
      if (
        trackId &&
        state.visibleTrackIds &&
        !state.visibleTrackIds.includes(trackId)
      ) {
        state.visibleTrackIds = [...state.visibleTrackIds, trackId];
        revealed = true;
      }
    });
    if (revealed) get().markDirty();
  },

  setVisibleTracks: trackIds => {
    if (trackIds.length === 0) return;
    set(state => {
      state.visibleTrackIds = [...trackIds];
    });
    get().markDirty();
  },
  setThemeMode: mode => {
    set(state => {
      state.themeMode = mode;
    });
  },
  setZoom: zoom => {
    set(state => {
      state.zoom = zoom;
    });
  },
  setSnapGrid: grid => {
    set(state => {
      state.snapGrid = grid;
    });
  },
  setPitchDisplay: display => {
    set(state => {
      state.pitchDisplay = display;
    });
  },
  setEditMode: mode => {
    set(state => {
      state.editMode = mode;
    });
  },
  setActiveVoice: voiceIndex => {
    // Clamped rather than trusted: a negative index would silently write into
    // `voices[-1]`, which is not a voice and not an error either.
    set(state => {
      state.activeVoiceIndex = Math.max(0, Math.floor(voiceIndex));
    });
  },
  setDeveloperMode: enabled => {
    set(state => {
      state.developerMode = enabled;
    });
  },
  setDevSettings: patch => {
    set(state => {
      Object.assign(state.devSettings, patch);
    });
  },
  openDialog: id => {
    set(state => {
      state.dialogs[id] = true;
    });
  },
  closeDialog: id => {
    set(state => {
      state.dialogs[id] = false;
    });
  },
  toggleDialog: id => {
    set(state => {
      state.dialogs[id] = !state.dialogs[id];
    });
  },
  pushToast: toast => {
    const id = createId();
    set(state => {
      state.toasts.push({
        id,
        message: toast.message,
        severity: toast.severity ?? 'info',
        ...(toast.action ? { action: toast.action } : {}),
      });
    });
    return id;
  },
  dismissToast: id => {
    set(state => {
      state.toasts = state.toasts.filter(t => t.id !== id);
    });
  },
});
