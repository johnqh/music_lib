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

/**
 * The velocity each note in a hairpin ramps to.
 *
 * A dynamic sets a level; a hairpin is the *change* between two of them, so
 * the only honest way to sound one is to ramp. The span runs from the note
 * carrying `hairpinStart` to the one carrying `hairpinStop`, and velocity
 * moves linearly from the level in force at the opening to the level in force
 * just **after** the close — which is how a player reads it: the wedge takes
 * you to the next marking.
 *
 * **Where there is no next marking**, the wedge still has to arrive somewhere.
 * A crescendo with nothing after it goes one dynamic step up from where it
 * started, and a diminuendo one step down. That is what a player does with an
 * unresolved hairpin, and it beats the alternatives: leaving it flat makes the
 * marking silent, and ramping to full or to nothing turns an unmarked detail
 * into the loudest or quietest thing in the piece.
 *
 * Returns an empty map for a score with no hairpin, so an unmarked passage
 * costs one allocation and no arithmetic.
 */
export function hairpinVelocities(
  events: readonly MusicalEvent[],
  inForce: Map<string, Dynamic>
): Map<string, number> {
  const ramped = new Map<string, number>();
  const notes = events.filter(isNoteEvent);

  /** The velocity a note would sound at from its dynamic alone. */
  const levelOf = (index: number): number => {
    const note = notes[index];
    if (!note) return DEFAULT_VELOCITY;
    const dynamic = inForce.get(note.id);
    return dynamic ? velocityForDynamic(dynamic) : DEFAULT_VELOCITY;
  };

  for (let i = 0; i < notes.length; i += 1) {
    if (!notes[i].hairpinStart) continue;
    const kind = notes[i].hairpinStart;

    let stop = -1;
    for (let j = i; j < notes.length; j += 1) {
      if (notes[j].hairpinStop) {
        stop = j;
        break;
      }
    }
    // An unclosed opening ramps nowhere, matching what the renderer draws.
    if (stop < 0) break;

    const from = levelOf(i);
    const afterIndex = stop + 1;
    const next =
      afterIndex < notes.length ? inForce.get(notes[afterIndex].id) : undefined;
    const startDynamic = inForce.get(notes[i].id);
    const to =
      next && next !== startDynamic
        ? velocityForDynamic(next)
        : stepFrom(from, kind === 'crescendo' ? 1 : -1);

    const span = stop - i;
    for (let k = 0; k <= span; k += 1) {
      const t = span === 0 ? 1 : k / span;
      ramped.set(notes[i + k].id, Math.round(from + (to - from) * t));
    }
    i = stop;
  }
  return ramped;
}

/**
 * One dynamic step from `velocity`, in `direction`.
 *
 * Used only where a hairpin has nothing to resolve to. Walks the ladder rather
 * than adding a fixed number so the step is the same size a written marking
 * would have been.
 */
function stepFrom(velocity: number, direction: 1 | -1): number {
  const ladder = DYNAMIC_LADDER.map(velocityForDynamic);
  const nearest = ladder.reduce((best, v) =>
    Math.abs(v - velocity) < Math.abs(best - velocity) ? v : best
  );
  const index = ladder.indexOf(nearest);
  const target =
    ladder[Math.max(0, Math.min(ladder.length - 1, index + direction))];
  // At the top of the ladder a crescendo still has to go somewhere.
  return target === nearest
    ? Math.max(1, Math.min(127, velocity + direction * 16))
    : target;
}

/** Softest to loudest, for stepping one marking at a time. */
const DYNAMIC_LADDER: readonly Dynamic[] = [
  'ppp',
  'pp',
  'p',
  'mp',
  'mf',
  'f',
  'ff',
  'fff',
];
