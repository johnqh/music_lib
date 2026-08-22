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
import { clefAtMeasure } from '../score/effective-clef.js';
import { beatDurationTicks, measureDurationTicks } from '../time/ticks.js';
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

/**
 * Sets the repeat barlines and volta numbers on a bar.
 *
 * Applied at the same **measure index** across every track, not just the one
 * whose id was given: a repeat is a property of the piece's structure, and a
 * `:|` printed on the top stave but not the others would be a score that reads
 * differently depending on which part you play from.
 *
 * A patch rather than three commands, because the Measure tab sets them
 * together and each one alone would be its own undo entry.
 */
export type RepeatPatch = {
  repeatStart?: boolean;
  repeatEnd?: boolean;
  endingNumbers?: number[];
};

function changeRepeats(
  score: Score,
  measureId: UUID,
  patch: RepeatPatch
): Score {
  const index = score.tracks
    .map(track => track.measures.findIndex(m => m.id === measureId))
    .find(i => i !== -1);
  if (index === undefined || index === -1) return score;

  const tracks = score.tracks.map(track => {
    const measure = track.measures[index];
    if (!measure) return track;

    const updated: Measure = { ...measure };
    // Absent means "no repeat here", so a false or an empty list removes the
    // field rather than storing a marking that prints nothing.
    if (patch.repeatStart === undefined) {
      // untouched
    } else if (patch.repeatStart) updated.repeatStart = true;
    else delete updated.repeatStart;

    if (patch.repeatEnd === undefined) {
      // untouched
    } else if (patch.repeatEnd) updated.repeatEnd = true;
    else delete updated.repeatEnd;

    if (patch.endingNumbers !== undefined) {
      if (patch.endingNumbers.length > 0)
        updated.endingNumbers = [...patch.endingNumbers].sort((a, b) => a - b);
      else delete updated.endingNumbers;
    }

    const measures = track.measures.slice();
    measures[index] = updated;
    return { ...track, measures };
  });

  return withTracks(score, tracks);
}

export function changeRepeatsCommand(
  measureId: UUID,
  patch: RepeatPatch,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    changeRepeats(score, measureId, patch)
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

/**
 * Sets or clears a clef change at one measure of one track.
 *
 * Per **track**, unlike `changeRepeatsCommand`, which applies at the same index
 * across every track: a repeat barline that differed between staves would be a
 * score that reads differently depending on which part you play from, but a
 * clef change is exactly the opposite — a piano left hand crossing into treble
 * says nothing about what the right hand is doing.
 *
 * `undefined` removes the change, so the bar goes back to inheriting. Setting
 * the clef already in force at that bar removes it too, rather than storing a
 * marking that would print nothing: `clefChangesAt` treats a redundant one as
 * no change, and leaving it behind would make "clear" and "set to the current
 * clef" produce different scores that look identical.
 *
 * Measure 0 is where a clef is *established* rather than changed, so it writes
 * the **track** clef instead — which is what keeps one clef per track true for
 * a part that never changes, and stops bar 1 printing a change against nothing.
 */
export function changeMeasureClefCommand(
  trackId: UUID,
  measureIndex: number,
  clef: Clef | undefined,
  label: string
): ScoreCommand {
  return transformCommand(label, score => {
    const track = score.tracks.find(t => t.id === trackId);
    if (!track || measureIndex < 0 || measureIndex >= track.measures.length) {
      return score;
    }

    // Bar 0 sets the part's clef, and goes through `changeClef` so a crossing
    // into or out of percussion still reinterprets the program.
    if (measureIndex === 0) {
      return clef ? changeClef(score, trackId, clef) : score;
    }

    const inherited = clefAtMeasure(
      track.measures,
      measureIndex - 1,
      track.clef
    );
    const measures = track.measures.map((measure, i) => {
      if (i !== measureIndex) return measure;
      if (!clef || clef === inherited) {
        if (measure.clef === undefined) return measure;
        const next = { ...measure };
        delete next.clef;
        return next;
      }
      return { ...measure, clef };
    });

    return {
      ...score,
      tracks: score.tracks.map(t =>
        t.id === trackId ? { ...t, measures } : t
      ),
    };
  });
}

/**
 * Turns the score's first bar into a pickup of `beats` beats, or removes the
 * pickup and restores a full bar.
 *
 * Only the first bar, because that is what an anacrusis is — the run-up to bar
 * 1. A short bar anywhere else is an irregular bar, which keeps its number and
 * is a different thing entirely.
 *
 * Applies to **every track**, like `changeRepeatsCommand` and unlike the clef:
 * the measure grid is shared, and a pickup on one stave and not the others is
 * a score whose parts disagree about where bar 1 starts.
 *
 * Notes that no longer fit are dropped rather than the bar refusing to shrink:
 * a pickup is normally set before anything is written, and silently keeping a
 * note past the barline would leave the bar failing validation.
 */
export function setPickupCommand(
  beats: number | null,
  label: string
): ScoreCommand {
  return transformCommand(label, score => {
    const first = score.tracks[0]?.measures[0];
    if (!first) return score;

    const beatTicks = beatDurationTicks(first.timeSignature, score.ppq);
    const full = measureDurationTicks(first.timeSignature, score.ppq);
    const wanted =
      beats === null
        ? full
        : Math.max(1, Math.min(Math.round(beats) * beatTicks, full - 1));

    const tracks = score.tracks.map(track => {
      const measure = track.measures[0];
      if (!measure) return track;
      const trimmed: Measure = {
        ...measure,
        durationTicks: wanted,
        voices: measure.voices.map(voice => ({
          ...voice,
          events: voice.events
            .filter(e => e.startTick - measure.startTick < wanted)
            .map(e => ({
              ...e,
              durationTicks: Math.min(
                e.durationTicks,
                measure.startTick + wanted - e.startTick
              ),
            })),
        })),
      };
      if (beats === null) delete trimmed.pickup;
      else trimmed.pickup = true;
      return { ...track, measures: [trimmed, ...track.measures.slice(1)] };
    });

    // Every following bar shifts, since bar 0 changed length.
    return rebuildMeasureTicks({ ...score, tracks });
  });
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

/**
 * Drops a tempo change.
 *
 * The first event is never removed: it is the score's starting tempo, and a
 * score with an empty `tempoMap` has no tempo at all. Asking to remove it is a
 * no-op rather than an error, because the only caller is a button that should
 * simply not be offered there.
 */
function removeTempo(score: Score, tempoEventId: UUID): Score {
  if (score.tempoMap.length <= 1 || score.tempoMap[0]?.id === tempoEventId)
    return score;

  const tempoMap = score.tempoMap.filter(e => e.id !== tempoEventId);
  if (tempoMap.length === score.tempoMap.length) return score;

  return { ...score, tempoMap, metadata: touchMetadata(score.metadata) };
}

export function removeTempoCommand(
  tempoEventId: UUID,
  label: string
): ScoreCommand {
  return transformCommand(label, score => removeTempo(score, tempoEventId));
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
