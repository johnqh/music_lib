/**
 * Structural (measure/track/score-property) command factories (spec §7,
 * §14). Each factory wraps a pure `(Score) => Score` transform via
 * `transformCommand`, matching the note-commands.ts pattern.
 */
import {
  appendMeasure,
  createTrack,
  rebuildMeasureTicks,
} from '../score/factory.js';
import { gmKitAt } from '../instruments/gm-kit.js';
import { gmInstrument } from '../instruments/gm.js';
import type { CreateTrackOptions } from '../score/factory.js';
import { createId } from '../score/ids.js';
import { measureDurationTicks } from '../time/ticks.js';
import type {
  Clef,
  KeySignature,
  Measure,
  Score,
  ScoreMetadata,
  TempoEvent,
  TimeSignature,
  Track,
  UUID,
} from '@sudobility/music_types';
import type { CommandKind, ScoreCommand } from './types.js';
import { transformCommand } from './snapshot.js';
import { reflowVoice, touchMetadata, withTracks } from './reflow.js';

// ---- addMeasureCommand / deleteMeasureCommand ----------------------------------

/** Appends one fully-rested measure to every track (reuses Task 3's `appendMeasure`). */
export function addMeasureCommand(label: string): ScoreCommand {
  return transformCommand(label, score => appendMeasure(score));
}

function deleteMeasure(score: Score, measureIndex: number): Score {
  const tracks = score.tracks.map(track => {
    const filtered = track.measures.filter(m => m.index !== measureIndex);
    return filtered.length === track.measures.length
      ? track
      : { ...track, measures: filtered };
  });
  return rebuildMeasureTicks(withTracks(score, tracks));
}

/** Removes the measure at `measureIndex` from every track, retracking subsequent measures' ticks. */
export function deleteMeasureCommand(
  measureIndex: number,
  label: string
): ScoreCommand {
  return transformCommand(label, score => deleteMeasure(score, measureIndex));
}

// ---- addTrackCommand / deleteTrackCommand --------------------------------------

/** Builds a fully-rested measure matching an existing measure's position/signatures, for a newly added track. */
export function restMeasureLike(reference: Measure, trackId: UUID): Measure {
  const voiceId = createId();
  return {
    id: createId(),
    index: reference.index,
    startTick: reference.startTick,
    durationTicks: reference.durationTicks,
    timeSignature: reference.timeSignature,
    keySignature: reference.keySignature,
    voices: [
      {
        id: voiceId,
        name: 'Voice 1',
        events: [
          {
            id: createId(),
            startTick: reference.startTick,
            durationTicks: reference.durationTicks,
            voiceId,
            trackId,
          },
        ],
      },
    ],
  };
}

function addTrack(score: Score, options: CreateTrackOptions): Score {
  const track = createTrack(options);
  const referenceTrack = score.tracks[0];
  const measures = referenceTrack
    ? referenceTrack.measures.map(m => restMeasureLike(m, track.id))
    : [];
  return {
    ...score,
    tracks: [...score.tracks, { ...track, measures }],
    metadata: touchMetadata(score.metadata),
  };
}

/** Adds a new track, fully-rested with the same measure layout (count/signatures) as the score's first existing track. */
export function addTrackCommand(
  options: CreateTrackOptions,
  label: string
): ScoreCommand {
  return transformCommand(label, score => addTrack(score, options));
}

function deleteTrack(score: Score, trackId: UUID): Score {
  const tracks = score.tracks.filter(t => t.id !== trackId);
  return withTracks(score, tracks);
}

/** Removes the track with id `trackId`. */
export function deleteTrackCommand(trackId: UUID, label: string): ScoreCommand {
  return transformCommand(label, score => deleteTrack(score, trackId));
}

// ---- changeTimeSignatureCommand / changeKeySignatureCommand -------------------

function changeTimeSignature(
  score: Score,
  measureId: UUID,
  timeSignature: TimeSignature
): Score {
  const tracks = score.tracks.map(track => {
    const index = track.measures.findIndex(m => m.id === measureId);
    if (index === -1) return track;

    const measure = track.measures[index];
    const durationTicks = measureDurationTicks(timeSignature, score.ppq);
    let updated: Measure = { ...measure, timeSignature, durationTicks };
    for (const voice of updated.voices) {
      updated = reflowVoice(updated, voice.id, track.id);
    }

    const measures = track.measures.slice();
    measures[index] = updated;
    return { ...track, measures };
  });

  return rebuildMeasureTicks(withTracks(score, tracks));
}

/**
 * Changes one measure's time signature (on every track that has a measure
 * with that id — normally exactly one, but the search covers every track
 * defensively). Recomputes the measure's `durationTicks`, reflows its
 * voices to fit the new length, and retracks every subsequent measure via
 * `rebuildMeasureTicks`.
 */
export function changeTimeSignatureCommand(
  measureId: UUID,
  timeSignature: TimeSignature,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    changeTimeSignature(score, measureId, timeSignature)
  );
}

function changeKeySignature(
  score: Score,
  measureId: UUID,
  keySignature: KeySignature
): Score {
  const tracks = score.tracks.map(track => {
    const index = track.measures.findIndex(m => m.id === measureId);
    if (index === -1) return track;
    const measures = track.measures.slice();
    measures[index] = { ...measures[index], keySignature };
    return { ...track, measures };
  });
  return withTracks(score, tracks);
}

/** Changes one measure's key signature. Existing note spellings are left as-is. */
export function changeKeySignatureCommand(
  measureId: UUID,
  keySignature: KeySignature,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    changeKeySignature(score, measureId, keySignature)
  );
}

// ---- changeClefCommand -----------------------------------------------------------

function changeClef(score: Score, trackId: UUID, clef: Clef): Score {
  const tracks = score.tracks.map(t =>
    t.id === trackId ? { ...t, clef, ...programForClef(t, clef) } : t
  );
  return withTracks(score, tracks);
}

/**
 * The program a track should carry once its clef is `clef`.
 *
 * `midiProgram` addresses a drum kit on a percussion track and an instrument
 * anywhere else, so crossing that boundary reinterprets the number it already
 * holds. Going in, it is snapped to the kit whose region it falls in; coming
 * out, it is reset to Acoustic Grand, because a kit address as an instrument is
 * whatever program happens to sit there — Brush becomes a violin. `name` is
 * deliberately left alone: it is the user's, unlike `instrumentName`, which
 * describes the sound and so has to follow it.
 */
function programForClef(track: Track, clef: Clef): Partial<Track> {
  const wasPercussion = track.clef === 'percussion';
  const isPercussion = clef === 'percussion';
  if (wasPercussion === isPercussion) return {};
  if (isPercussion) {
    const kit = gmKitAt(track.midiProgram);
    return { midiProgram: kit.program, instrumentName: kit.name };
  }
  const instrument = gmInstrument(0);
  return {
    midiProgram: 0,
    instrumentName: instrument?.name ?? 'Acoustic Grand Piano',
  };
}

/** Changes a track's clef, reinterpreting its program if it crosses into or out of percussion. */
export function changeClefCommand(
  trackId: UUID,
  clef: Clef,
  label: string
): ScoreCommand {
  return transformCommand(label, score => changeClef(score, trackId, clef));
}

// ---- changeTempoCommand -----------------------------------------------------------

export type ChangeTempoParams = {
  tempoEventId?: UUID;
  tick: number;
  bpm: number;
};

function changeTempo(score: Score, params: ChangeTempoParams): Score {
  const tempoMap: TempoEvent[] = params.tempoEventId
    ? score.tempoMap.map(e =>
        e.id === params.tempoEventId
          ? { ...e, tick: params.tick, bpm: params.bpm }
          : e
      )
    : [
        ...score.tempoMap,
        { id: createId(), tick: params.tick, bpm: params.bpm },
      ];

  const sorted = [...tempoMap].sort((a, b) => a.tick - b.tick);
  return {
    ...score,
    tempoMap: sorted,
    metadata: touchMetadata(score.metadata),
  };
}

/** Updates an existing tempo event (`tempoEventId` given) or inserts a new one, keeping `tempoMap` sorted by tick. */
export function changeTempoCommand(
  params: ChangeTempoParams,
  label: string
): ScoreCommand {
  return transformCommand(label, score => changeTempo(score, params));
}

// ---- changeMetadataCommand --------------------------------------------------------

function changeMetadata(
  score: Score,
  patch: Partial<Omit<ScoreMetadata, 'createdAt'>>
): Score {
  return {
    ...score,
    metadata: {
      ...score.metadata,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Patches score metadata (title/composer/description); `createdAt` is immutable, `updatedAt` is always refreshed. */
export function changeMetadataCommand(
  patch: Partial<Omit<ScoreMetadata, 'createdAt'>>,
  label: string
): ScoreCommand {
  return transformCommand(label, score => changeMetadata(score, patch));
}

// ---- changeTrackPropsCommand ------------------------------------------------------

export type TrackPropsPatch = Partial<Omit<Track, 'id' | 'measures'>>;

function changeTrackProps(
  score: Score,
  trackId: UUID,
  patch: TrackPropsPatch
): Score {
  const tracks = score.tracks.map(t =>
    t.id === trackId ? { ...t, ...patch } : t
  );
  return withTracks(score, tracks);
}

/**
 * The track properties that are mixing rather than music.
 *
 * `changeTrackPropsCommand` carries a partial patch and serves both purposes —
 * `{ muted }` is mixing, `{ name }` and `{ midiProgram }` are the score — so
 * the content/mix classification cannot be made on the command's type. It is
 * made here, where the patch is, rather than in a switch elsewhere that would
 * have to be kept in step with this list.
 */
const MIX_PROPS = new Set<string>(['volume', 'pan', 'muted', 'solo']);

/** A patch is mix only if *every* key in it is. An empty patch changes nothing, so it counts as mix. */
function trackPatchKind(patch: TrackPropsPatch): CommandKind {
  return Object.keys(patch).every(key => MIX_PROPS.has(key))
    ? 'mix'
    : 'content';
}

/** Patches a track's non-structural properties (name, instrument, MIDI program/channel, clef, volume, pan, mute, solo). */
export function changeTrackPropsCommand(
  trackId: UUID,
  patch: TrackPropsPatch,
  label: string
): ScoreCommand {
  return transformCommand(
    label,
    score => changeTrackProps(score, trackId, patch),
    trackPatchKind(patch)
  );
}
