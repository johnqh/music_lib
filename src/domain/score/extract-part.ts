/**
 * A single track, written the way its player reads it.
 *
 * **Print-only.** The returned score is never saved, never played and never
 * edited — it is a notation of the music, not the music. Playback uses
 * sounding pitch, and routing this into it would make a trumpet sound a tone
 * sharp.
 *
 * Features 3 to 5 extend this same function with multi-measure rests,
 * rehearsal marks and cue notes, which is why part extraction lives in one
 * place rather than four.
 */
import { gmWrittenTransposition } from '../instruments/gm-transposition.js';
import { collapseRests } from './collapse-rests.js';
import { applyRehearsalMarks, rehearsalMarks } from './rehearsal-marks.js';
import { applyCues, measureCues } from './cue-notes.js';
import { transposeMeasure } from './written-pitch.js';
import type { Score } from '@sudobility/music_types';

/**
 * The part for `trackId`: that track alone, transposed for its instrument.
 *
 * Returns `null` when the track is not in the score, rather than an empty
 * score — an empty part and a missing one are different problems, and only one
 * of them is a bug.
 */
export function extractPart(score: Score, trackId: string): Score | null {
  const track = score.tracks.find((t) => t.id === trackId);
  if (!track) return null;

  // Cues first, at concert pitch: chosen from the other tracks as they sound,
  // then carried through the transposition below into the player's own key.
  const cued = applyCues(track.measures, measureCues(score, trackId));

  const semitones = gmWrittenTransposition(track.midiProgram);
  const written =
    semitones === 0 ? cued : cued.map((measure) => transposeMeasure(measure, semitones));

  // Marks come from the WHOLE score, not this track: "from B" has to mean the
  // same bar in every part, and a per-track derivation would give each player
  // different letters.
  const marked = applyRehearsalMarks(written, rehearsalMarks(score));

  // Collapse last. Marks and cues must already be on: both end a rest run, and
  // either one hidden inside a multi-measure rest would point at nothing.
  return { ...score, tracks: [{ ...track, measures: collapseRests(marked) }] };
}
