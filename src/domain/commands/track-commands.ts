/**
 * Appending a whole track to a score.
 *
 * What remains of a file that also wrote transcriptions in: audio transcription
 * moved to `midi_transcriber_api` and arrives as MIDI, so the score is built by
 * the MIDI importer rather than a note at a time. Generation still appends a
 * single produced track, which is this.
 */
import { touchMetadata, withTracks } from './reflow.js';
import { transformCommand } from './snapshot.js';
import { restMeasureLike } from './structure-commands.js';
import { createId } from '../score/ids.js';
import type { Track } from '@sudobility/music_types';
import type { ScoreCommand } from './types.js';

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
