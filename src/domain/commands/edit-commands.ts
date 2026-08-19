/**
 * Copy/paste, quantize, and transpose command factories (spec §7, §14,
 * §24). Each factory wraps a pure `(Score) => Score` transform via
 * `transformCommand`.
 */
import { createId } from '../score/ids.js';
import { splitNoteAcrossMeasures } from '../score/ties.js';
import type {
  MusicalEvent,
  NoteEvent,
  Score,
  UUID,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { transposePitch } from '../pitch/transpose.js';
import { quantizeEvents } from '../quantization/quantize.js';
import type { QuantizeOptions } from '../quantization/options.js';
import type { ScoreCommand } from './types.js';
import { transformCommand } from './snapshot.js';
import { insertNoteIntoTrack, reflowVoice, withTracks } from './reflow.js';

// ---- pasteEventsCommand -----------------------------------------------------------

export type PasteDestination = {
  trackId: UUID;
  voiceIndex: number;
  anchorTick: number;
};

function pasteEvents(
  score: Score,
  notes: readonly NoteEvent[],
  destination: PasteDestination
): Score {
  const track = score.tracks.find(t => t.id === destination.trackId);
  if (!track || notes.length === 0) return score;

  const originStart = Math.min(...notes.map(n => n.startTick));
  const boundaries = track.measures.map(m => m.startTick);

  let working = track;
  for (const note of notes) {
    const startTick = destination.anchorTick + (note.startTick - originStart);
    const placeholder: NoteEvent = {
      ...note,
      id: createId(),
      startTick,
      trackId: destination.trackId,
      tieStart: undefined,
      tieStop: undefined,
    };
    const segments = splitNoteAcrossMeasures(placeholder, boundaries);
    for (const segment of segments) {
      working = insertNoteIntoTrack(working, segment, destination.voiceIndex);
    }
  }

  const tracks = score.tracks.map(t => (t.id === track.id ? working : t));
  return withTracks(score, tracks);
}

/**
 * Pastes a copied list of note events (e.g. from a prior "copy" of a
 * selection) into `destination.trackId`/`voiceIndex`, anchored so the
 * earliest-starting pasted note lands at `destination.anchorTick` and
 * every other note keeps its relative offset. A pasted note that ends up
 * crossing a measure boundary is split into tied segments, matching
 * `moveNotesCommand`. Ids are regenerated so pasted notes never collide
 * with their source.
 */
export function pasteEventsCommand(
  notes: NoteEvent[],
  destination: PasteDestination,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    pasteEvents(score, notes, destination)
  );
}

// ---- quantizeCommand -----------------------------------------------------------

/** Clips `event` to fit within `measure`'s span, or returns `null` if that leaves no positive duration. */
function clipToMeasure(
  event: MusicalEvent,
  measureStart: number,
  measureEnd: number
): MusicalEvent | null {
  const start = Math.max(event.startTick, measureStart);
  const end = Math.min(event.startTick + event.durationTicks, measureEnd);
  if (end <= start) return null;
  return { ...event, startTick: start, durationTicks: end - start };
}

/**
 * One voice (identified by `trackId`/`measureId`/`voiceId`) touched by a
 * quantize action, with its *note* events already extracted (not the
 * synthetic rests `reflowVoice` fills gaps with — feeding those into
 * `quantizeEvents` alongside real notes could snap a filler rest's start
 * independently of its neighboring note and corrupt the measure). Building
 * this list is O(score) but doesn't itself call `quantizeEvents` — see
 * `collectQuantizeTargets`'s doc comment for why it's split out as its own
 * step (Task 17).
 */
export type QuantizeTarget = {
  trackId: UUID;
  measureId: UUID;
  voiceId: UUID;
  notes: NoteEvent[];
};

/**
 * The cheap, non-quantizing "which voices does this selection touch, and
 * what are their current notes" pass of quantization: walks the score once
 * and collects one `QuantizeTarget` per voice containing at least one of
 * `eventIds`. Split out from `quantizeCommand`'s transform so the
 * intent layer (`editing.ts`'s `quantizeSelection`, `interactions.ts`'s
 * `commitQuantize`) can run this synchronously to decide *how much* work a
 * quantize action actually implies (spec §29: route a manual quantize of
 * >2000 events through `services/quantization/quantize-service.ts`'s
 * worker) before committing to the expensive `quantizeEvents` call either
 * on the main thread or off it — without duplicating this measure/voice
 * walk in two places.
 */
export function collectQuantizeTargets(
  score: Score,
  eventIds: readonly UUID[]
): QuantizeTarget[] {
  const idSet = new Set(eventIds);
  const targets: QuantizeTarget[] = [];
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        if (!voice.events.some(e => idSet.has(e.id))) continue;
        targets.push({
          trackId: track.id,
          measureId: measure.id,
          voiceId: voice.id,
          notes: voice.events.filter(isNoteEvent),
        });
      }
    }
  }
  return targets;
}

/**
 * Splices each target's already-quantized notes (`quantizedByVoiceId`,
 * keyed by `QuantizeTarget.voiceId` — computed by the caller via
 * `quantizeEvents`) back into `score`: clips each note back to its measure's span, then
 * `reflowVoice` regenerates that voice's rests around the result. This
 * keeps quantization measure-local (no cross-measure re-splitting), a
 * deliberate Task 5 scope limitation documented in the original brief.
 * A target whose `voiceId` has no entry in `quantizedByVoiceId` is treated
 * as "nothing computed for it" (splices in an empty note list) — the
 * sole caller (`quantize`, below) always populates every target's key
 * before calling this.
 */
export function applyQuantizedGroups(
  score: Score,
  targets: readonly QuantizeTarget[],
  quantizedByVoiceId: ReadonlyMap<UUID, MusicalEvent[]>
): Score {
  const targetsByTrackMeasure = new Map<string, QuantizeTarget[]>();
  for (const target of targets) {
    const key = `${target.trackId}::${target.measureId}`;
    const list = targetsByTrackMeasure.get(key);
    if (list) list.push(target);
    else targetsByTrackMeasure.set(key, [target]);
  }

  const tracks = score.tracks.map(track => {
    const measures = track.measures.map(measure => {
      const measureTargets = targetsByTrackMeasure.get(
        `${track.id}::${measure.id}`
      );
      if (!measureTargets) return measure;

      let nextMeasure = measure;
      const measureEnd = measure.startTick + measure.durationTicks;
      for (const target of measureTargets) {
        const quantizedNotes = (quantizedByVoiceId.get(target.voiceId) ?? [])
          .map(e => clipToMeasure(e, measure.startTick, measureEnd))
          .filter((e): e is MusicalEvent => e !== null);
        const withQuantized = {
          ...nextMeasure,
          voices: nextMeasure.voices.map(v =>
            v.id === target.voiceId ? { ...v, events: quantizedNotes } : v
          ),
        };
        nextMeasure = reflowVoice(withQuantized, target.voiceId, track.id);
      }
      return nextMeasure;
    });
    const trackChanged = measures.some((m, i) => m !== track.measures[i]);
    return trackChanged ? { ...track, measures } : track;
  });

  return withTracks(score, tracks);
}

/**
 * Quantizes the voice(s) containing any of `eventIds`, calling
 * `quantizeEvents` synchronously for every touched voice.
 *
 * This is the only path. A >2000-event selection used to be routed through a
 * worker instead, via a precomputed-groups variant of this command; that was
 * removed once the offload was measured at 0.57ms of saved work against a
 * structured clone of the whole event array in each direction.
 */
function quantize(
  score: Score,
  eventIds: readonly UUID[],
  options: QuantizeOptions
): Score {
  const targets = collectQuantizeTargets(score, eventIds);
  const quantizedByVoiceId = new Map(
    targets.map(t => [t.voiceId, quantizeEvents(t.notes, options)] as const)
  );
  return applyQuantizedGroups(score, targets, quantizedByVoiceId);
}

/** Quantizes every voice containing at least one of `eventIds`, per Task 4's reusable quantization engine. */
export function quantizeCommand(
  eventIds: UUID[],
  options: QuantizeOptions,
  label: string
): ScoreCommand {
  return transformCommand(label, score => quantize(score, eventIds, options));
}

// ---- transposeCommand -----------------------------------------------------------

function transpose(
  score: Score,
  eventIds: readonly UUID[],
  semitones: number
): Score {
  const idSet = new Set(eventIds);
  const tracks = score.tracks.map(track => {
    const measures = track.measures.map(measure => {
      const voices = measure.voices.map(voice => {
        if (!voice.events.some(e => idSet.has(e.id))) return voice;
        return {
          ...voice,
          events: voice.events.map(event =>
            isNoteEvent(event) && idSet.has(event.id)
              ? {
                  ...event,
                  pitch: transposePitch(
                    event.pitch,
                    semitones,
                    measure.keySignature
                  ),
                }
              : event
          ),
        };
      });
      const measureChanged = voices.some((v, i) => v !== measure.voices[i]);
      return measureChanged ? { ...measure, voices } : measure;
    });
    const trackChanged = measures.some((m, i) => m !== track.measures[i]);
    return trackChanged ? { ...track, measures } : track;
  });
  return withTracks(score, tracks);
}

/** Transposes the given notes by `semitones`, re-spelling each per its own measure's key signature. */
export function transposeCommand(
  eventIds: UUID[],
  semitones: number,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    transpose(score, eventIds, semitones)
  );
}
