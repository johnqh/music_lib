/**
 * Writing a transcription into the score.
 *
 * **One command, so one undo step.** An import can produce hundreds of notes;
 * looping `addNoteCommand` would make undoing it hundreds of presses, the same
 * trap the drag-to-move gesture had to avoid.
 *
 * Always a **new** track: an import must never overwrite work that is already
 * there, and there is no sensible merge for "here is a recording of something".
 */
import { createTrack } from '../score/factory.js';
import { midiToPitch } from '../pitch/pitch.js';
import { insertNoteIntoTrack, touchMetadata, withTracks } from './reflow.js';
import { transformCommand } from './snapshot.js';
import { restMeasureLike } from './structure-commands.js';
import { createId } from '../score/ids.js';
import type { NoteEvent, Score } from '@sudobility/music_types';
import type { ScoreCommand } from './types.js';
import type { TranscribedNote } from '../audio/transcribe.js';

export type AddTranscribedTrackParams = {
  name: string;
  notes: readonly TranscribedNote[];
  /** GM program for the new track. Defaults to piano. */
  midiProgram?: number;
};

function addTranscribedTrack(score: Score, params: AddTranscribedTrackParams): Score {
  const reference = score.tracks[0];
  if (!reference) return score;

  const track = createTrack({
    name: params.name,
    instrumentName: params.name,
    ...(params.midiProgram === undefined ? {} : { midiProgram: params.midiProgram }),
  });

  // Same measure grid as the rest of the score, fully rested, then the notes
  // written in — so the new track lines up with everything else by
  // construction rather than by arithmetic.
  let withMeasures = { ...track, measures: reference.measures.map((m) => restMeasureLike(m, track.id)) };

  for (const note of params.notes) {
    // A note past the end of the score belongs to no measure, so it is
    // dropped rather than clamped into a pile on the last beat — clamping
    // would misrepresent the recording. `insertNoteIntoTrack` would ignore it
    // anyway; this lookup is here for the key signature.
    const measure = withMeasures.measures.find(
      (m) => note.startTick >= m.startTick && note.startTick < m.startTick + m.durationTicks,
    );
    if (!measure) continue;

    const event: NoteEvent = {
      id: createId(),
      pitch: midiToPitch(note.midi, measure.keySignature),
      startTick: note.startTick,
      durationTicks: note.durationTicks,
      velocity: 80,
      voiceId: '',
      trackId: track.id,
    };
    withMeasures = insertNoteIntoTrack(withMeasures, event, 0);
  }

  return {
    ...withTracks(score, [...score.tracks, withMeasures]),
    metadata: touchMetadata(score.metadata),
  };
}

/** Adds a new track carrying `notes`, in one undoable step. */
export function addTranscribedTrackCommand(params: AddTranscribedTrackParams): ScoreCommand {
  return transformCommand('Import audio', (score) => addTranscribedTrack(score, params));
}
