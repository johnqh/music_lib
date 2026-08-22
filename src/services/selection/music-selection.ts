/**
 * The selection, held in one place.
 *
 * A plain holder with listeners — deliberately no logic. Every rule about what
 * *becomes* selected (a shift-click extending a measure span, a cmd-click
 * running from the caret, a track falling back to the first when the active
 * one is deleted) stays in the store's selection actions, which is where those
 * rules already live and are already tested. Duplicating any of them here
 * would create the second opinion this type exists to prevent.
 */
import type {
  IMusicSelectionSource,
  ScoreSelection,
  UUID,
  UnsubscribeSelection,
} from '@sudobility/music_types';

const EMPTY: ScoreSelection = { eventIds: [], measureIds: [], trackIds: [] };

export class MusicSelection implements IMusicSelectionSource {
  private readonly listeners = new Set<() => void>();

  private current: ScoreSelection = EMPTY;

  private active: UUID | null = null;

  get selection(): ScoreSelection {
    return this.current;
  }

  get noteIds(): readonly UUID[] {
    return this.current.eventIds;
  }

  get measureIds(): readonly UUID[] {
    return this.current.measureIds;
  }

  get trackIds(): readonly UUID[] {
    return this.current.trackIds;
  }

  get activeTrackId(): UUID | null {
    return this.active;
  }

  subscribe(listener: () => void): UnsubscribeSelection {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSelection(selection: ScoreSelection): void {
    this.current = selection;
    this.emit();
  }

  setActiveTrackId(trackId: UUID | null): void {
    // Guarded because the store writes this on every track click, including
    // the clicks that land on the track already active — and a notation
    // redraw is not something to trigger for a change that did not happen.
    if (this.active === trackId) return;
    this.active = trackId;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
