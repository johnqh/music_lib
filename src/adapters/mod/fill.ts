/**
 * Filling a voice's gaps with rests.
 *
 * A voice must cover its measure exactly or the notation is wrong — a bar
 * carrying 1200 ticks of a 1920-tick measure renders short. The module importer
 * did not do this, which produced 554 `measure-underfull` warnings on a real
 * module and bars that visibly did not add up.
 *
 * Pure arithmetic over an event list: no score model, no bytes, and every
 * tracker format's importer gets it for free.
 */
import { decomposeDuration } from '../../domain/time/durations.js';
import { createId } from '../../domain/score/ids.js';
import type { MusicalEvent, NoteEvent, UUID } from '@sudobility/music_types';

/**
 * `events` with rests inserted before, between and after them, so the result
 * tiles `[measureStartTick, measureStartTick + measureDurationTicks)` exactly.
 *
 * `events` must be sorted by `startTick` and must not overlap — which is what
 * the caller's voice allocation already guarantees, since a note that overlaps
 * one already placed goes to the next voice.
 */
export function fillVoiceWithRests(
  events: NoteEvent[],
  measureStartTick: number,
  measureDurationTicks: number,
  ppq: number,
  trackId: UUID,
  voiceId: UUID
): MusicalEvent[] {
  const measureEnd = measureStartTick + measureDurationTicks;
  const out: MusicalEvent[] = [];
  let at = measureStartTick;

  /** A gap may be longer than any single drawable value, so it can become several rests. */
  const addRests = (from: number, to: number): void => {
    let cursor = from;
    for (const ticks of decomposeDuration(to - from, ppq)) {
      out.push({
        id: createId(),
        startTick: cursor,
        durationTicks: ticks,
        voiceId,
        trackId,
      });
      cursor += ticks;
    }
  };

  for (const event of events) {
    if (event.startTick > at) addRests(at, event.startTick);
    out.push({ ...event, voiceId, trackId });
    at = event.startTick + event.durationTicks;
  }

  if (at < measureEnd) addRests(at, measureEnd);

  return out;
}
