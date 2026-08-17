/**
 * The high-frequency half of playback, kept out of the store.
 *
 * Position arrives ~30 times a second and the sounding set changes on every
 * note boundary. Routing either through Zustand means every subscriber in the
 * app is notified at that rate, which is why the editor grew five separately
 * isolated readout components and a rule in CLAUDE.md reminding everyone not to
 * read those fields at a component's top level. The rule was correct and
 * enforced by memory: one `store((s) => s.positionTick)` in the wrong place
 * silently cost twenty renders a second.
 *
 * Here the fields simply are not in the store, so that subscription cannot be
 * written. What remains in Zustand is the low-frequency state — transport
 * state, loop, tempo, metronome, volume, load progress — which behaves like
 * ordinary React state because it is.
 *
 * Three separate channels rather than one "playback changed" event: a
 * subscriber that cares about position must not wake when a note starts, and
 * the caret and the piano keyboard genuinely care about different things.
 */
import type { SoundingNote, TransportPlaybackState } from '@sudobility/music_types';

export type Unsubscribe = () => void;

export class PlaybackBus {
  private readonly positionListeners = new Set<(tick: number) => void>();
  private readonly soundingListeners = new Set<(notes: readonly SoundingNote[]) => void>();
  private readonly transportListeners = new Set<(state: TransportPlaybackState) => void>();

  /** The last values published, so a subscriber joining mid-playback is not blind until the next event. */
  private lastPosition = 0;
  private lastSounding: readonly SoundingNote[] = [];
  private lastTransport: TransportPlaybackState = 'stopped';

  onPosition(listener: (tick: number) => void): Unsubscribe {
    this.positionListeners.add(listener);
    return () => this.positionListeners.delete(listener);
  }

  onSounding(listener: (notes: readonly SoundingNote[]) => void): Unsubscribe {
    this.soundingListeners.add(listener);
    return () => this.soundingListeners.delete(listener);
  }

  onTransport(listener: (state: TransportPlaybackState) => void): Unsubscribe {
    this.transportListeners.add(listener);
    return () => this.transportListeners.delete(listener);
  }

  publishPosition(tick: number): void {
    this.lastPosition = tick;
    for (const listener of this.positionListeners) listener(tick);
  }

  /**
   * The engine already emits only on change (`SoundingSet`), so this does not
   * filter again — doing so would hide a deliberate re-publish after a seek.
   */
  publishSounding(notes: readonly SoundingNote[]): void {
    this.lastSounding = notes;
    for (const listener of this.soundingListeners) listener(notes);
  }

  publishTransport(state: TransportPlaybackState): void {
    this.lastTransport = state;
    for (const listener of this.transportListeners) listener(state);
  }

  /** Where playback last reported it was. Read once on subscribe; do not poll this. */
  get positionTick(): number {
    return this.lastPosition;
  }

  get sounding(): readonly SoundingNote[] {
    return this.lastSounding;
  }

  get transport(): TransportPlaybackState {
    return this.lastTransport;
  }

  /** Drops every listener. For teardown; a live app never calls this. */
  clear(): void {
    this.positionListeners.clear();
    this.soundingListeners.clear();
    this.transportListeners.clear();
  }
}
