import { createId } from './ids.js';
import { findEvent, findTrack } from './queries.js';
import type { MusicalEvent, NoteEvent, Pitch, Score, Track, UUID } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { splitAtBoundaries } from '../time/durations.js';

/** Whether two pitches have identical spelling (step, accidental, and octave). */
function samePitch(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.accidental === b.accidental && a.octave === b.octave;
}

/**
 * Splits a note at every measure boundary that falls strictly inside its
 * span, returning contiguous tied segments that together cover the
 * original note. The first segment keeps the original id and any incoming
 * tie (`tieStop`); the last keeps any outgoing tie (`tieStart`); segments
 * in between are tied on both sides. Returns `[note]` unchanged if no
 * boundary falls inside its span.
 *
 * Every returned segment inherits `note`'s `voiceId`/`trackId` verbatim.
 * This function has no `Score`/`Measure` context, so it cannot know which
 * voice a later segment will actually land in once inserted into the
 * score — the caller (which does have that context) is responsible for
 * reassigning each segment's `voiceId` to its destination measure's voice
 * before/while inserting it (the same normalization `fragment.ts`'s
 * `replaceFragment` performs).
 */
export function splitNoteAcrossMeasures(note: NoteEvent, measureBoundaries: number[]): NoteEvent[] {
  const segments = splitAtBoundaries(note.startTick, note.durationTicks, measureBoundaries);
  if (segments.length <= 1) {
    return [note];
  }

  return segments.map((segment, i) => {
    const isFirst = i === 0;
    const isLast = i === segments.length - 1;
    return {
      ...note,
      id: isFirst ? note.id : createId(),
      startTick: segment.startTick,
      durationTicks: segment.durationTicks,
      tieStart: isLast ? note.tieStart : true,
      tieStop: isFirst ? note.tieStop : true,
    };
  });
}

/**
 * Merges runs of contiguous, same-pitch, tie-linked note events into single
 * notes spanning the combined duration. Partners are matched by
 * `(startTick, pitch, tie flags)`, not raw array adjacency, so tied chord
 * members can be joined even when another chord member sits between them.
 * Rests and non-tied notes pass through unchanged. Assumes `events` are
 * already in ascending `startTick` order (e.g. one voice's events).
 */
export function joinTiedNotes(events: MusicalEvent[]): MusicalEvent[] {
  const result: MusicalEvent[] = [];
  const consumed = new Set<UUID>();

  for (const event of events) {
    if (consumed.has(event.id)) continue;
    if (!isNoteEvent(event) || !event.tieStart) {
      result.push(event);
      continue;
    }

    let merged: NoteEvent = event;
    consumed.add(event.id);
    while (merged.tieStart) {
      const next = events.find(
        (candidate): candidate is NoteEvent =>
          !consumed.has(candidate.id) &&
          isNoteEvent(candidate) &&
          Boolean(candidate.tieStop) &&
          candidate.startTick === merged.startTick + merged.durationTicks &&
          samePitch(candidate.pitch, merged.pitch),
      );
      if (!next) break;
      consumed.add(next.id);
      merged = { ...merged, durationTicks: merged.durationTicks + next.durationTicks, tieStart: next.tieStart };
    }

    result.push(merged);
  }

  return result;
}

/** A note event annotated with the index (within its track) of the measure it came from. */
export type ChannelCandidate = { event: NoteEvent; measureIndex: number };

/**
 * The ordinal index (position within `measure.voices`) of the voice
 * containing `noteId`, searching every measure of `track` in order.
 * Returns -1 if `noteId` isn't found in any voice of this track.
 */
function locateVoiceIndex(track: Track, noteId: UUID): number {
  for (const measure of track.measures) {
    const voiceIndex = measure.voices.findIndex((voice) => voice.events.some((e) => e.id === noteId));
    if (voiceIndex !== -1) return voiceIndex;
  }
  return -1;
}

/**
 * Every note event from the voice at ordinal position `voiceIndex` in
 * each of `track`'s measures (a measure with no voice at that index
 * contributes nothing), in measure/tick order. This is the "channel" a
 * tie chain is searched within.
 *
 * Voice ids are freshly generated per measure and so are not stable
 * across a barline (spec §25 permits per-measure voice reallocation), so
 * they can't be used to correlate "the same voice" from one measure to
 * the next. A voice's *ordinal position* in `measure.voices` is used as
 * a stand-in instead — a deliberate, documented approximation, not a
 * guarantee that voice N in one measure is musically continuous with
 * voice N in the next.
 *
 * Exported (Task 17) so `validation/validator.ts`'s `checkTieTargets` can
 * build each track/voice-ordinal channel once and index it for O(1)-average
 * partner lookups, instead of paying for a fresh `tieChainFor` walk (which
 * itself rebuilds a channel from scratch) per tied note — see that
 * function's doc comment for the super-linear-worst-case history.
 */
export function voiceChannel(track: Track, voiceIndex: number): ChannelCandidate[] {
  const channel: ChannelCandidate[] = [];
  track.measures.forEach((measure, measureIndex) => {
    const voice = measure.voices[voiceIndex];
    if (!voice) return;
    for (const event of voice.events) {
      if (isNoteEvent(event)) channel.push({ event, measureIndex });
    }
  });
  channel.sort((a, b) => a.measureIndex - b.measureIndex || a.event.startTick - b.event.startTick);
  return channel;
}

/**
 * The note in `channel` that `note` ties into (its `tieStart` partner),
 * found by explicit (tick, pitch, tie-flag) matching — never by array
 * adjacency, so an unrelated same-tick note (e.g. a coincidental chord
 * tone sharing `note`'s channel) can't be picked up by accident.
 */
function findForwardPartner(channel: ChannelCandidate[], note: NoteEvent): NoteEvent | undefined {
  if (!note.tieStart) return undefined;
  return channel.find(
    (c) =>
      c.event.id !== note.id &&
      c.event.startTick === note.startTick + note.durationTicks &&
      Boolean(c.event.tieStop) &&
      samePitch(c.event.pitch, note.pitch),
  )?.event;
}

/** The note in `channel` that ties into `note` (its `tieStop` partner); see `findForwardPartner`. */
function findBackwardPartner(channel: ChannelCandidate[], note: NoteEvent): NoteEvent | undefined {
  if (!note.tieStop) return undefined;
  return channel.find(
    (c) =>
      c.event.id !== note.id &&
      c.event.startTick + c.event.durationTicks === note.startTick &&
      Boolean(c.event.tieStart) &&
      samePitch(c.event.pitch, note.pitch),
  )?.event;
}

/**
 * Returns the full chain of tied note events (in tick order) that `noteId`
 * belongs to, searching across all of its track's measures. A chain may
 * span measure boundaries. Returns `[]` if `noteId` does not exist or is
 * not a note event; returns a single-element array for a note with no
 * ties.
 *
 * Chain membership is searched only within the target's own "voice
 * channel" (`voiceChannel`, above — the voice at the same ordinal
 * position across every measure of the track), never across voices. This
 * matters once a measure has more than one voice (spec §25 voice
 * allocation): searching across all voices indiscriminately would let a
 * coincidental same-pitch, tie-flagged note in an unrelated voice at a
 * barline get spliced into the chain, or shadow the true partner when
 * both share the same tick. Within the channel, a partner is found by
 * explicit (tick, pitch, tie-flag) matching, not raw array adjacency, for
 * the same reason.
 */
export function tieChainFor(score: Score, noteId: UUID): NoteEvent[] {
  const target = findEvent(score, noteId);
  if (!target || !isNoteEvent(target)) return [];

  const track = findTrack(score, target.trackId);
  if (!track) return [target];

  const voiceIndex = locateVoiceIndex(track, target.id);
  if (voiceIndex === -1) return [target];

  const channel = voiceChannel(track, voiceIndex);
  const chain: NoteEvent[] = [target];

  let current = target;
  for (let guard = 0; guard < channel.length; guard += 1) {
    const partner = findBackwardPartner(channel, current);
    if (!partner) break;
    chain.unshift(partner);
    current = partner;
  }

  current = target;
  for (let guard = 0; guard < channel.length; guard += 1) {
    const partner = findForwardPartner(channel, current);
    if (!partner) break;
    chain.push(partner);
    current = partner;
  }

  return chain;
}
