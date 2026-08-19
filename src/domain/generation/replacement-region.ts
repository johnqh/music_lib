/**
 * What a Replace action will overwrite.
 *
 * Three scopes, one shape. The important one is `notes`: its range is the
 * selected notes' exact tick span and is deliberately NOT snapped out to
 * measure boundaries, which is what every other regeneration path does
 * (`selectionToRange`, and through it `prepareRegenerationRequest`, always
 * align). A caller that snaps this has changed the feature into Replace
 * Measures.
 *
 * A non-contiguous selection is reported as its bounding span, so notes the
 * user did not select can fall inside it. `unselectedNoteCount` exists so the
 * UI can say so before anything is replaced, rather than leaving it to be
 * discovered afterwards.
 */
import type {
  Score,
  ScoreRange,
  ScoreSelection,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { findEvent, findMeasure, findTrack } from '../score/queries.js';

export type ReplaceScope = 'notes' | 'measures' | 'track';

export type ReplacementRegion = {
  range: ScoreRange;
  /** Whether `range` falls on measure boundaries. False only for `notes`. */
  measureAligned: boolean;
  /** How many notes fall inside `range` on `range.trackIds`. */
  noteCount: number;
  /** How many of those the user did not select — what the modal warns about. */
  unselectedNoteCount: number;
};

/** Ids of every note overlapping `range` on its tracks. Overlap, not containment: a note straddling the boundary is replaced too. */
function noteIdsInRange(score: Score, range: ScoreRange): string[] {
  const ids: string[] = [];
  for (const trackId of range.trackIds) {
    const track = findTrack(score, trackId);
    if (!track) continue;
    for (const measure of track.measures)
      for (const voice of measure.voices)
        for (const event of voice.events)
          if (
            isNoteEvent(event) &&
            event.startTick < range.endTick &&
            event.startTick + event.durationTicks > range.startTick
          )
            ids.push(event.id);
  }
  return ids;
}

function withCounts(
  score: Score,
  range: ScoreRange,
  measureAligned: boolean,
  selectedIds: Set<string>
): ReplacementRegion {
  const inRange = noteIdsInRange(score, range);
  return {
    range,
    measureAligned,
    noteCount: inRange.length,
    unselectedNoteCount: inRange.filter(id => !selectedIds.has(id)).length,
  };
}

/**
 * The region a Replace action would overwrite, or `null` when the scope has
 * nothing to work on — which is what disables its button.
 */
export function replacementRegion(
  score: Score,
  selection: ScoreSelection,
  activeTrackId: string | null,
  scope: ReplaceScope
): ReplacementRegion | null {
  if (scope === 'track') {
    const track = activeTrackId ? findTrack(score, activeTrackId) : null;
    if (!track) return null;
    const last = track.measures.at(-1);
    if (!last) return null;
    return withCounts(
      score,
      {
        startTick: 0,
        endTick: last.startTick + last.durationTicks,
        trackIds: [track.id],
      },
      true,
      new Set()
    );
  }

  if (scope === 'measures') {
    const measures = selection.measureIds
      .map(id => findMeasure(score, id))
      .filter(m => m !== null);
    if (measures.length === 0) return null;
    // The selected ids already encode the track set: a gutter click selects the
    // active track's measure, cmd-shift-click every track's.
    const trackIds = [
      ...new Set(
        selection.measureIds
          .map(
            id => score.tracks.find(t => t.measures.some(m => m.id === id))?.id
          )
          .filter(id => id !== undefined)
      ),
    ];
    return withCounts(
      score,
      {
        startTick: Math.min(...measures.map(m => m.startTick)),
        endTick: Math.max(...measures.map(m => m.startTick + m.durationTicks)),
        trackIds,
      },
      true,
      new Set()
    );
  }

  const notes = selection.eventIds
    .map(id => findEvent(score, id))
    .filter(e => e !== null && isNoteEvent(e));
  if (notes.length === 0) return null;

  return withCounts(
    score,
    {
      startTick: Math.min(...notes.map(n => n.startTick)),
      endTick: Math.max(...notes.map(n => n.startTick + n.durationTicks)),
      trackIds: [...new Set(notes.map(n => n.trackId))],
    },
    false,
    new Set(notes.map(n => n.id))
  );
}
