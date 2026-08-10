/**
 * Turning a voice's recorded timing into timing that can actually be notated.
 *
 * A recorded performance does not land on note values. This score has onsets
 * at ticks 0, 3, 233, 355, 1113 — and there is no such thing as a 233-tick
 * note. `ticksToVexDuration` therefore rounds every duration to the nearest
 * value it *can* draw, and those roundings accumulate: one voice of a 1920-tick
 * bar came out notated as 3360 ticks, and five voices of another bar each
 * drifted by a different amount.
 *
 * That is not merely cosmetic. VexFlow positions notes by accumulating each
 * voice's notated durations, so voices that disagree about how long the bar is
 * end up on different timelines: the same tick drew at x=407 on one stave and
 * x=599 on another, and voices whose arithmetic happened to come out short were
 * squeezed into the left third of the bar while the longest one filled it.
 *
 * The fix is to decide display timing *before* anything is rounded. Onsets snap
 * to a grid, each group runs until the next one starts, and the last runs to the
 * barline. Two properties follow, and they are the whole point:
 *
 *   - every duration is a whole number of grid steps, which
 *     `decomposeDuration` represents exactly (verified across every multiple up
 *     to a full bar), so nothing rounds and nothing drifts; and
 *   - the durations sum to exactly the bar, for every voice, so every stave
 *     shares one timeline.
 *
 * A score that was already quantized passes through unchanged: its onsets are
 * already on the grid, and a gap-filled voice's durations already are the gaps.
 * So this only ever moves notes that could not have been drawn correctly.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type { MusicalEvent } from '@sudobility/music_types';

/**
 * The display grid, as a divisor of the quarter note: 8 gives a 1/32 note.
 *
 * Not a free parameter. `decomposeDuration` must represent every multiple of
 * the grid exactly or the drift this module exists to remove comes straight
 * back, and 1/32 is the finest grid for which that holds — at 1/64 twenty-one
 * of the sixty-four multiples in a 4/4 bar cannot be written, and finer grids
 * are worse. Triplets are already approximated here (nothing in this adapter
 * draws tuplets), so the grid costs them nothing they had.
 */
const GRID_DIVISOR = 8;

/** Ticks per display grid step. At the usual 480 ppq this is 60. */
export function displayGridTicks(ppq: number): number {
  return Math.max(1, Math.round(ppq / GRID_DIVISOR));
}

/**
 * One drawn tickable: the events that sound at this point, and how long it
 * occupies the bar. A chord is several events in one group.
 */
export type DisplayGroup = {
  events: MusicalEvent[];
  /** Always a whole number of grid steps; the groups sum to the measure. */
  durationTicks: number;
};

/**
 * Groups `events` (one voice of one measure, in ascending start order) into
 * drawable tickables whose durations sum to exactly `measureDurationTicks`.
 *
 * `measureStartTick` is subtracted first, so callers pass absolute domain
 * ticks and this works in measure-relative space throughout.
 *
 * Events that snap to the same grid step become one group — which is how a
 * rolled chord recorded three ticks apart is drawn as the chord it is, rather
 * than as three consecutive notes that between them overrun the bar.
 */
export function displayGroups(
  events: MusicalEvent[],
  measureStartTick: number,
  measureDurationTicks: number,
  ppq: number,
): DisplayGroup[] {
  if (events.length === 0 || measureDurationTicks <= 0) return [];

  const grid = displayGridTicks(ppq);
  // The last step a group may begin on: a group has to have room to last at
  // least one step, or it would be a zero-length tickable.
  const lastStart = Math.max(0, Math.floor((measureDurationTicks - 1) / grid) * grid);

  const byStart = new Map<number, MusicalEvent[]>();
  for (const event of events) {
    const snapped = Math.min(
      lastStart,
      Math.max(0, Math.round((event.startTick - measureStartTick) / grid) * grid),
    );
    const at = byStart.get(snapped);
    if (at) at.push(event);
    else byStart.set(snapped, [event]);
  }

  const starts = [...byStart.keys()].sort((a, b) => a - b);
  return starts.map((start, index) => ({
    // A rest that snapped onto a note's step would draw a rest through a
    // sounding note, so notes win their step and the rest simply vanishes —
    // it was silence that turned out to be shorter than the grid.
    events: preferNotes(byStart.get(start)!),
    durationTicks: (starts[index + 1] ?? measureDurationTicks) - start,
  }));
}

function preferNotes(events: MusicalEvent[]): MusicalEvent[] {
  const notes = events.filter(isNoteEvent);
  return notes.length > 0 ? notes : events;
}
