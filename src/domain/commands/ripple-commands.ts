/**
 * Insert that pushes existing music out of the way, rather than overwriting it.
 *
 * Separate from `addNoteCommand`, which is measure-local by design ("an add
 * always targets one named measure"): a ripple spans measures and can lengthen
 * the score, so folding it into that command would break the contract its
 * callers rely on.
 */
import { appendMeasure } from '../score/factory.js';
import { allNotes, scoreEndTick } from '../score/queries.js';
import { addNoteCommand, moveNotesCommand } from './note-commands.js';
import { transformCommand } from './snapshot.js';
import type { ScoreCommand } from './types.js';
import type { Articulation, Pitch, Score, UUID } from '@sudobility/music_types';

export type RippleInsertParams = {
  trackId: UUID;
  measureId: UUID;
  voiceIndex: number;
  pitch: Pitch;
  startTick: number;
  durationTicks: number;
  articulation?: Articulation;
};

/**
 * Room for `neededTicks` more music on `trackId`, adding measures to EVERY
 * track when the shifted tail would pass the final barline.
 *
 * All tracks, not just the edited one: measures are per-track, but the layout
 * takes each measure's width as the maximum density across tracks at that
 * index, so a track with more measures than its neighbours would misalign
 * every barline beneath it.
 */
function growToFit(score: Score, trackId: UUID, neededTicks: number): Score {
  const lastNoteEnd = allNotes(score)
    .filter((note) => note.trackId === trackId)
    .reduce((end, note) => Math.max(end, note.startTick + note.durationTicks), 0);

  let next = score;
  // Bounded by the arithmetic, not by trust: each pass adds a whole measure,
  // so the shortfall strictly shrinks.
  while (lastNoteEnd + neededTicks > scoreEndTick(next)) {
    next = appendMeasure(next);
  }
  return next;
}

/**
 * `score` with `ticks` of empty time opened up at `atTick` on `trackId`.
 *
 * Shared by note entry and paste: both need the same "push this track's later
 * music out of the way, growing the score if it runs off the end" behaviour,
 * and duplicating it would let the two drift.
 */
export function makeRoom(score: Score, trackId: UUID, atTick: number, ticks: number): Score {
  const grown = growToFit(score, trackId, ticks);

  // Gathered by id rather than by span: `moveNotesCommand` is the primitive
  // that already knows how to re-place notes and reflow their measures.
  const displaced = allNotes(grown)
    .filter((note) => note.trackId === trackId && note.startTick >= atTick)
    .map((note) => note.id);
  if (displaced.length === 0) return grown;

  return moveNotesCommand(displaced, { deltaTicks: ticks, deltaSemitones: 0 }).execute(grown);
}

/**
 * `score` with `ticks` of time removed at `fromTick` on `trackId` — everything
 * after the gap slides earlier to close it.
 *
 * The inverse of `makeRoom`, and what "move the notes behind up" means after a
 * cut. Measures are deliberately NOT removed: the piece keeps its length and
 * gains rests at the end, because dropping a bar is a structural edit the user
 * did not ask for, and it would misalign every other track.
 *
 * Notes that start inside the removed span are left where they are rather than
 * dragged backwards past `fromTick`. A cut removes them first, so in practice
 * there are none; guarding anyway keeps this honest if it is ever called on a
 * span that still has content.
 */
export function closeGap(score: Score, trackId: UUID, fromTick: number, ticks: number): Score {
  if (ticks <= 0) return score;

  const displaced = allNotes(score)
    .filter((note) => note.trackId === trackId && note.startTick >= fromTick + ticks)
    .map((note) => note.id);
  if (displaced.length === 0) return score;

  return moveNotesCommand(displaced, { deltaTicks: -ticks, deltaSemitones: 0 }).execute(score);
}

/**
 * Writes a note at `startTick`, moving everything at or after it on the same
 * track later by the note's own duration.
 *
 * Only that track moves. The edited part deliberately shifts against its
 * accompaniment — that is what inserting into one part means, and it is the
 * reason the mode exists.
 */
export function insertWithRippleCommand(params: RippleInsertParams): ScoreCommand {
  return transformCommand('Insert note', (score) => {
    const shifted = makeRoom(score, params.trackId, params.startTick, params.durationTicks);

    return addNoteCommand({
      trackId: params.trackId,
      measureId: params.measureId,
      voiceIndex: params.voiceIndex,
      pitch: params.pitch,
      startTick: params.startTick,
      durationTicks: params.durationTicks,
      ...(params.articulation ? { articulation: params.articulation } : {}),
    }).execute(shifted);
  });
}
