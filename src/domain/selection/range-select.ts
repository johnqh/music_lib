/**
 * Caret-to-click range selection (the cmd-click gesture). Pure over `Score`
 * — no store, no DOM — so the tick math is unit-testable without rendering.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type { Score, UUID } from '@sudobility/music_types';

/**
 * Every note whose `startTick` falls in `[min(fromTick,toTick),
 * max(...))` on one of `trackIds`, in ascending tick order.
 *
 * Half-open on purpose: cmd-clicking exactly on a note selects everything up
 * to it but not the note itself, so two adjacent ranges sharing a boundary
 * don't both claim the note sitting on it. Rests are skipped — they aren't
 * selectable material for any downstream action (transpose, regenerate,
 * copy all operate on notes).
 */
export function noteIdsInTickRange(
  score: Score,
  fromTick: number,
  toTick: number,
  trackIds: readonly UUID[]
): UUID[] {
  const start = Math.min(fromTick, toTick);
  const end = Math.max(fromTick, toTick);
  if (start === end || trackIds.length === 0) return [];

  const wanted = new Set(trackIds);
  const hits: Array<{ id: UUID; startTick: number }> = [];

  for (const track of score.tracks) {
    if (!wanted.has(track.id)) continue;
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (!isNoteEvent(event)) continue;
          if (event.startTick >= start && event.startTick < end) {
            hits.push({ id: event.id, startTick: event.startTick });
          }
        }
      }
    }
  }

  return hits.sort((a, b) => a.startTick - b.startTick).map(h => h.id);
}
