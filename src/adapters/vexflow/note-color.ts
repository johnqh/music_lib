/**
 * Note color-role resolution. Pure: no VexFlow, no store, no DOM — so the
 * precedence rule is unit-testable on its own and the canvas renderer only
 * has to call it.
 */
import type { NoteColorRole, RenderTheme } from './types.js';

/**
 * Highest precedence first. `playing` wins so playback stays followable even
 * over a selection; `regenerated` beats `selected` so a just-regenerated
 * passage stays visible while it is still selected.
 *
 * Pressing play clears the selection, so `playing` and `selected` do not
 * normally coexist — this ordering only resolves the case where the user
 * selects notes while playback is already running.
 */
const PRECEDENCE: readonly NoteColorRole[] = ['playing', 'regenerated', 'selected', 'normal'];

/**
 * The role to draw a VexFlow note with, given every domain event id it
 * represents (>1 for a chord, or for one segment of a duration-decomposed
 * long note). Ids absent from `noteColors` count as `normal`.
 */
export function resolveNoteColorRole(
  eventIds: readonly string[],
  noteColors: ReadonlyMap<string, NoteColorRole> | undefined,
): NoteColorRole {
  if (!noteColors || noteColors.size === 0) return 'normal';
  let best = PRECEDENCE.length - 1;
  for (const eventId of eventIds) {
    const role = noteColors.get(eventId);
    if (!role) continue;
    const rank = PRECEDENCE.indexOf(role);
    if (rank !== -1 && rank < best) best = rank;
  }
  return PRECEDENCE[best];
}

/**
 * The non-color half of a note's state cue (spec §27: "do not rely on color
 * alone"). The old highlight overlay carried this with solid/dashed/dotted
 * stroke patterns; those went away with the rectangles, so the weight of the
 * glyph carries it now — a thicker `lineWidth` on stems, flags and beams.
 *
 * Deliberately NOT a shadow. An earlier version added `shadowBlur` so the cue
 * would reach a notehead too (a filled glyph, which no stroke width can
 * thicken). Canvas shadows force the rasterizer down a separate blur pass per
 * draw, and this is applied to precisely the notes that change most often —
 * every note-on and note-off during playback, on the thread Tone.js schedules
 * from. Playback hesitated. The cue is worth less than smooth audio.
 *
 * The cost of that trade: a *stemless* whole note now has color as its only
 * cue. Every other note keeps the stroke-weight channel, and the selection
 * summary in the status bar and screen-reader text still names the state.
 *
 * One emphasis level for every non-normal state rather than three: the
 * perceptually important distinction is "is this note affected" versus "is it
 * not". `selected` and `regenerated` are mutually exclusive anyway
 * (`regenerated` is a property of the whole selection), and `playing` is
 * transient and accompanied by the moving caret.
 */
export function noteEmphasisFor(role: NoteColorRole): { lineWidth: number } {
  return { lineWidth: role === 'normal' ? 1 : 2.5 };
}

/** The theme color a role draws in. */
export function noteColorFor(role: NoteColorRole, theme: RenderTheme): string {
  switch (role) {
    case 'playing':
      return theme.notePlaying;
    case 'regenerated':
      return theme.noteRegenerated;
    case 'selected':
      return theme.noteSelected;
    case 'normal':
      return theme.noteNormal;
  }
}
