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

/**
 * The longest note value that still draws a filled notehead, in quarters.
 * A half note is hollow, and a hollow drum hit reads as the wrong instruction.
 */
const LONGEST_FILLED_QUARTERS = 1;

/** Ticks per display grid step. At the usual 480 ppq this is 60. */
export function displayGridTicks(ppq: number): number {
  return Math.max(1, Math.round(ppq / GRID_DIVISOR));
}

/**
 * One drawn tickable: the events that sound at this point, and how long it
 * occupies the bar. A chord is several events in one group.
 */
export type DisplayGroup = {
  /**
   * The events sounding at this point. **Empty means a spacer**: time that has
   * to be accounted for so the voice still sums to the bar, but that draws
   * nothing. `buildVoiceContent` renders those as VexFlow `GhostNote`s.
   */
  events: MusicalEvent[];
  /** Always a whole number of grid steps; the groups sum to the measure. */
  durationTicks: number;
};

/**
 * Where this voice's notes begin, snapped to the display grid.
 *
 * Exported for layout: the number of distinct onsets across a measure's tracks
 * is the number of tick contexts VexFlow will build, and therefore what its
 * minimum width is proportional to. Counting raw events instead over-allocated
 * badly — a drum bar of 37 recorded hits draws as 16 tickables once
 * near-simultaneous strikes are chorded, and it was being given width for 37.
 */
export function snappedOnsetTicks(
  events: MusicalEvent[],
  measureStartTick: number,
  measureDurationTicks: number,
  ppq: number,
): number[] {
  if (events.length === 0 || measureDurationTicks <= 0) return [];
  return snappedOnsets(events, measureStartTick, measureDurationTicks, ppq).map((o) => o.start);
}

/**
 * The events of one voice, grouped onto snapped onsets and sorted.
 *
 * Shared by both layouts below so they cannot disagree about where a note
 * begins — only about how long it is drawn.
 */
function snappedOnsets(
  events: MusicalEvent[],
  measureStartTick: number,
  measureDurationTicks: number,
  ppq: number,
): Array<{ start: number; events: MusicalEvent[] }> {
  const grid = displayGridTicks(ppq);

  // An onset that rounds up to the barline is the next bar's note recorded a
  // few ticks early, not an onset in this one. This score has such a note at
  // tick 1915 of a 1920-tick bar. Giving it its own step would open a tick
  // context one grid step before the barline, and VexFlow spends width on a
  // context in proportion to it *being* one, not to how long it lasts: that
  // sliver took a fifth of the bar, squeezing the sixteen real notes into 80%
  // of the width and leaving what looked like a gap before the barline.
  //
  // So it joins the last real onset instead. Only onsets that round to the
  // barline are touched — a genuine note a grid step before it rounds to its
  // own step and keeps it.
  const atBarline: MusicalEvent[] = [];
  const byStart = new Map<number, MusicalEvent[]>();
  for (const event of events) {
    const snapped = Math.max(0, Math.round((event.startTick - measureStartTick) / grid) * grid);
    if (snapped >= measureDurationTicks) {
      atBarline.push(event);
      continue;
    }
    const at = byStart.get(snapped);
    if (at) at.push(event);
    else byStart.set(snapped, [event]);
  }

  for (const event of atBarline) {
    const last = byStart.size > 0 ? Math.max(...byStart.keys()) : 0;
    const at = byStart.get(last);
    if (at) at.push(event);
    else byStart.set(last, [event]);
  }

  return [...byStart.keys()]
    .sort((a, b) => a - b)
    // A rest that snapped onto a note's step would draw a rest through a
    // sounding note, so notes win their step and the rest simply vanishes —
    // it was silence that turned out to be shorter than the grid.
    .map((start) => ({ start, events: preferNotes(byStart.get(start)!) }));
}

/**
 * Groups `events` (one voice of one measure, in ascending start order) into
 * drawable tickables whose durations sum to exactly `measureDurationTicks`.
 *
 * `measureStartTick` is subtracted first, so callers pass absolute domain
 * ticks and this works in measure-relative space throughout.
 *
 * Each group runs until the next one begins, which is what a single melodic
 * line wants: the notes join up and the bar is accounted for with no spacers.
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
  const onsets = snappedOnsets(events, measureStartTick, measureDurationTicks, ppq);
  return onsets.map((onset, index) => ({
    events: onset.events,
    durationTicks: (onsets[index + 1]?.start ?? measureDurationTicks) - onset.start,
  }));
}

/**
 * The same onsets, laid out for a drum staff: each hit runs to the next one,
 * but never long enough for its notehead to turn hollow.
 *
 * A kit part is not a melodic line, and a drum's recorded length is an
 * artifact — a struck cymbal rings however long the MIDI note says. What
 * matters is the rhythmic slot, so a hit runs to the next hit and the leftover
 * becomes spacers.
 *
 * The cap is what makes it readable. Stretching a kick to reach the next kick
 * two beats later would draw it as a half note, and half notes are hollow: a
 * kick on beats one and three would come out as two open noteheads, which
 * reads as a different instruction entirely. A quarter is the longest value
 * that is still filled and still obviously a hit.
 *
 * Using each hit's own recorded length instead does not work: drum hits are
 * recorded a few ticks long, so every one became the shortest drawable note
 * followed by a spacer — and spacers break beam groups, which turned a running
 * hi-hat into a row of flagged thirty-seconds.
 *
 * Spacers rather than rests: with hands and feet on one staff, a rest drawn in
 * the feet voice under a running hi-hat is clutter that says nothing a reader
 * needs. Drum charts routinely leave it out.
 */
export function drumDisplayGroups(
  events: MusicalEvent[],
  measureStartTick: number,
  measureDurationTicks: number,
  ppq: number,
): DisplayGroup[] {
  if (events.length === 0 || measureDurationTicks <= 0) return [];
  const onsets = snappedOnsets(events, measureStartTick, measureDurationTicks, ppq);
  const groups: DisplayGroup[] = [];

  // Time before the first hit still has to be accounted for, or the voice
  // would be short and every stave would disagree about the bar's length.
  if (onsets[0].start > 0) groups.push({ events: [], durationTicks: onsets[0].start });

  onsets.forEach((onset, index) => {
    const until = onsets[index + 1]?.start ?? measureDurationTicks;
    const available = until - onset.start;
    // The cap is about noteheads, so it applies to hits only. A rest has no
    // head to turn hollow and must span its whole silence: capped, a bar of
    // silence drew a quarter rest with the remaining three beats blank.
    const sounded = onset.events.some(isNoteEvent)
      ? Math.min(available, LONGEST_FILLED_QUARTERS * ppq)
      : available;
    groups.push({ events: onset.events, durationTicks: sounded });
    if (available > sounded) groups.push({ events: [], durationTicks: available - sounded });
  });

  return groups;
}

function preferNotes(events: MusicalEvent[]): MusicalEvent[] {
  const notes = events.filter(isNoteEvent);
  return notes.length > 0 ? notes : events;
}
