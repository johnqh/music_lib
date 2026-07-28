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
