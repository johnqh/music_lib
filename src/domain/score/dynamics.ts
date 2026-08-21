/**
 * What a dynamic marking does to the sound.
 *
 * A dynamic is stored on the note it starts at and is in force until the next
 * one on that track — the way it is read on paper. Resolving that into a
 * velocity per note is what makes the marking audible rather than decorative,
 * and it happens in `flattenScoreNotes`, the single traversal both live
 * playback and offline export already share, so the two cannot disagree about
 * how loud a passage is.
 *
 * **The note's own velocity survives.** A dynamic sets the level; the velocity
 * written on a note is kept as its deviation from the default, so an accent
 * inside a quiet passage stays an accent. The three rules that follow from it:
 *
 * - a score with no dynamics plays exactly as it did before they existed;
 * - a note left at the default under `ff` plays at `ff`;
 * - a note written louder than default under `ff` plays louder still.
 *
 * The alternative — a dynamic overwriting velocity outright, which is what
 * most notation software does — would have made the inspector's Velocity field
 * silently inert the moment a passage was marked, which is worse than either
 * behaviour on its own.
 */
import type { Dynamic, MusicalEvent, NoteEvent } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';

/**
 * The velocity each marking sounds at, for a note carrying no deviation.
 *
 * The usual MIDI ladder, evenly spread so each step is audibly a step. `mf` is
 * `DEFAULT_VELOCITY`, which is what makes an unmarked score unchanged.
 */
const DYNAMIC_VELOCITY: Record<Dynamic, number> = {
  ppp: 16,
  pp: 32,
  p: 48,
  mp: 64,
  mf: 80,
  f: 96,
  ff: 112,
  fff: 127,
};

/** The velocity a note is written at when nobody has said otherwise. */
export const DEFAULT_VELOCITY = 80;

export function velocityForDynamic(dynamic: Dynamic): number {
  return DYNAMIC_VELOCITY[dynamic];
}

/**
 * The velocity a note actually sounds at under `dynamic`.
 *
 * `null` means no dynamic is in force, and the written velocity stands.
 */
export function effectiveVelocity(
  note: NoteEvent,
  dynamic: Dynamic | null
): number {
  if (!dynamic) return note.velocity;
  const deviation = note.velocity - DEFAULT_VELOCITY;
  return Math.max(1, Math.min(127, velocityForDynamic(dynamic) + deviation));
}

/**
 * Walks one voice's events in order, reporting the dynamic in force at each.
 *
 * Takes an already-ordered channel — the caller has sorted and joined ties —
 * because "the next dynamic" only means anything in tick order.
 */
export function dynamicsInForce(
  events: readonly MusicalEvent[]
): Map<string, Dynamic> {
  const inForce = new Map<string, Dynamic>();
  let current: Dynamic | null = null;
  for (const event of events) {
    if (!isNoteEvent(event)) continue;
    if (event.dynamic) current = event.dynamic;
    if (current) inForce.set(event.id, current);
  }
  return inForce;
}
