/**
 * When the piano keyboard edits the selection instead of entering notes.
 *
 * Pure over a note list — no store, no DOM — so the rule that decides between
 * the keyboard's two jobs is testable on its own, in the same shape as
 * `tap-to-note.ts` and `pitch-drag.ts`.
 */
import type { NoteEvent } from '@sudobility/music_types';

export type ChordSelection = {
  startTick: number;
  durationTicks: number;
  trackId: string;
  voiceId: string;
  notes: NoteEvent[];
};

/**
 * The selection as one editable chord, or `null` when it is not exactly one.
 *
 * A chord is notes sharing a start tick in one voice. A selection spanning
 * several ticks contains more than one chord, and there is no defensible way
 * to guess which one the player meant — so the keyboard stays in entry mode
 * rather than editing something arbitrary. That the rule fits in a sentence is
 * the point: it has to be explainable in the UI.
 *
 * Voice, not just track: two voices on one stave routinely sound together, and
 * treating a melody note and the bass note underneath it as one chord would
 * let a key press edit a line the player was not looking at.
 */
export function chordSelection(
  notes: readonly NoteEvent[]
): ChordSelection | null {
  if (notes.length === 0) return null;

  const [first] = notes;
  const sameChord = notes.every(
    note =>
      note.startTick === first.startTick &&
      note.trackId === first.trackId &&
      note.voiceId === first.voiceId
  );
  if (!sameChord) return null;

  return {
    startTick: first.startTick,
    durationTicks: first.durationTicks,
    trackId: first.trackId,
    voiceId: first.voiceId,
    notes: [...notes],
  };
}
