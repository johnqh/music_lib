/**
 * Playback engine contract (spec §10). `PlaybackEngine` is the exact
 * interface spec §10 specifies, verbatim, plus `setObserver` (Task 13's
 * plan: the engine pushes position/active-note/transport-state updates to
 * whoever is listening — `services/playback/controller.ts` — via this
 * observer, rather than the engine reaching into the Zustand store
 * directly; no Tone.js/store coupling belongs here).
 *
 * The concrete implementation (`adapters/tone/tone-engine.ts`'s
 * `TonePlaybackEngine`) is the only thing that imports Tone.js; everything
 * that depends on `PlaybackEngine` (the controller, tests) depends on this
 * file instead, so it stays swappable and mockable.
 */
import type { Score } from '@sudobility/music_types';
import type { ScoreRange } from '../../domain/selection/types';

export type TransportPlaybackState = 'stopped' | 'playing' | 'paused';

/**
 * Callbacks the engine invokes as playback advances. `onPositionTick` fires
 * at roughly 30Hz while playing (spec §10 "update playback cursor
 * smoothly"); `onActiveNotes` fires whenever the set of currently-sounding
 * note ids changes (spec §10 "highlight active notes"); `onStateChange`
 * fires on every play/pause/stop transition (including ones the engine
 * itself initiates, e.g. pausing on tab-hide).
 */
export type PlaybackObserver = {
  onPositionTick(tick: number): void;
  onActiveNotes(noteIds: string[]): void;
  onStateChange(state: TransportPlaybackState): void;
};

/** Tone.js behind an abstraction (spec §10), verbatim interface plus `setObserver`. */
export interface PlaybackEngine {
  initialize(): Promise<void>;
  loadScore(score: Score): Promise<void>;
  play(fromTick?: number): Promise<void>;
  pause(): void;
  stop(): void;
  seek(tick: number): void;
  setTempoMultiplier(multiplier: number): void;
  setLoop(range: ScoreRange | null): void;
  setTrackMute(trackId: string, muted: boolean): void;
  setTrackSolo(trackId: string, solo: boolean): void;
  /**
   * Toggles the metronome click (spec §22). Not in spec §10's illustrative
   * interface snippet, but required to satisfy spec §22's "metronome
   * toggle" transport control — there is no other engine entry point for
   * it.
   */
  setMetronome(enabled: boolean): void;
  /** Sets overall output level, 0-1 linear gain (spec §22 "master volume"). */
  setMasterVolume(volume: number): void;
  /** Registers (or, with `null`, clears) the single observer receiving this engine's position/active-note/state updates. */
  setObserver(observer: PlaybackObserver | null): void;
  dispose(): void;
}
