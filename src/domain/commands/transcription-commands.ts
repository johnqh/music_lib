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
import type { NoteEvent, Score, Track } from '@sudobility/music_types';
import type { ScoreCommand } from './types.js';
import type { TranscribedNote } from '../audio/transcribe.js';

export type AddTranscribedTrackParams = {
  name: string;
  notes: readonly TranscribedNote[];
  /** GM program for the new track. Defaults to piano. */
  midiProgram?: number;
  /**
   * Clef for the new track. Defaults to treble.
   *
   * `'percussion'` is what makes a track a drum part — `isPercussionTrack`
   * reads the clef, and everything program-keyed goes through
   * `track-instrument.ts` on the strength of it. A transcribed drum stem has to
   * set this, or its `midiProgram` names an instrument rather than a kit.
   */
  clef?: Track['clef'];
};

function addTranscribedTrack(score: Score, params: AddTranscribedTrackParams): Score {
  const reference = score.tracks[0];
  if (!reference) return score;

  const track = createTrack({
    name: params.name,
    instrumentName: params.name,
    ...(params.midiProgram === undefined ? {} : { midiProgram: params.midiProgram }),
    ...(params.clef === undefined ? {} : { clef: params.clef }),
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

/**
 * Appends `track` to the score, re-homed onto the score's own measure grid.
 *
 * For a generated track: the AI returns a whole `Score`, and only its single
 * track is wanted. Its measures are matched to the existing grid by index
 * rather than trusted, because a generated score can come back with a
 * different bar count than was asked for, and a track whose measures do not
 * line up with its neighbours is not editable.
 *
 * Ids are regenerated so a track appended twice cannot collide with itself.
 */
export function appendTrackCommand(track: Track): ScoreCommand {
  return transformCommand('Add track', (score) => {
    const reference = score.tracks[0];
    if (!reference) return score;

    const id = createId();
    const measures = reference.measures.map((template, index) => {
      const source = track.measures[index];
      const voices = (source?.voices ?? []).map((voice) => {
        const voiceId = createId();
        return {
          id: voiceId,
          name: voice.name,
          events: voice.events.map((event) => ({
            ...event,
            id: createId(),
            voiceId,
            trackId: id,
          })),
        };
      });
      // An empty bar still needs a rest, which `restMeasureLike` supplies.
      return voices.length > 0
        ? { ...restMeasureLike(template, id), voices }
        : restMeasureLike(template, id);
    });

    return {
      ...withTracks(score, [...score.tracks, { ...track, id, measures }]),
      metadata: touchMetadata(score.metadata),
    };
  });
}
