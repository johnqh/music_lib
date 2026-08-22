/**
 * Which clef is in force at a given bar.
 *
 * `Measure.clef` stores only the *changes*, so almost every bar has none and
 * the answer has to be looked back for. That shape is deliberate — see the
 * field's own doc — but it means no consumer may read `measure.clef` directly
 * and expect the truth. They all come here instead: the renderer to draw the
 * stave, the hit test to turn a y coordinate into a pitch, the exporter to
 * decide when to emit a `<clef>`.
 *
 * Keeping it in one function is what stops the notation and the note-entry
 * geometry from disagreeing, which would place a clicked note on the line
 * above or below the one under the pointer — a bug that looks like a rounding
 * error and is not.
 */
import type { Clef, Measure, Track } from '@sudobility/music_types';

/**
 * The clef `measures[index]` is read in, given the track's own clef as the
 * starting point.
 *
 * Walks back to the most recent change rather than forward from the start, so
 * the common case — a track that never changes clef — costs one array read and
 * a miss.
 *
 * An index outside the array answers the track clef, which is what an empty
 * score and a caret past the last barline both need.
 */
export function clefAtMeasure(
  measures: readonly Measure[],
  index: number,
  trackClef: Clef
): Clef {
  for (let i = Math.min(index, measures.length - 1); i >= 0; i -= 1) {
    const clef = measures[i]?.clef;
    if (clef) return clef;
  }
  return trackClef;
}

/** The clef in force at `index` on `track`. */
export function effectiveClef(track: Track, index: number): Clef {
  return clefAtMeasure(track.measures, index, track.clef);
}

/**
 * Whether `index` is where the clef visibly changes — i.e. the first bar that
 * reads in a different clef from the one before it.
 *
 * Bar 0 is never a change: it is where the clef is first *established*, and
 * the renderer draws that as part of the system header rather than as a
 * change. A `Measure.clef` equal to what was already in force is likewise not
 * a change, so a redundant marking (which an import can produce) prints
 * nothing.
 */
export function clefChangesAt(track: Track, index: number): boolean {
  if (index <= 0 || index >= track.measures.length) return false;
  return effectiveClef(track, index) !== effectiveClef(track, index - 1);
}
