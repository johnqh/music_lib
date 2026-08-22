/**
 * Dragging a single selected note up and down the staff.
 *
 * Pure over the score and a pixel delta — no DOM, no store — so the arithmetic
 * is unit-testable, in the same shape as `autoscroll.ts`, `range-select.ts` and
 * `playback-scroll.ts`.
 */
import { STAVE_POSITION_HEIGHT } from '../../index.js';
import type { Score } from '@sudobility/music_types';
import type { Pitch } from '@sudobility/music_types';

/**
 * How many staff positions a vertical drag of `dy` screen pixels covers.
 *
 * Negative `dy` (upward) gives positive steps, because the staff counts upward
 * while screen y counts downward. Rounded, so the note settles on the position
 * nearest the pointer rather than only moving once the pointer has passed one
 * completely.
 */
export function stepsForDrag(dy: number, zoom: number): number {
  const perStep = STAVE_POSITION_HEIGHT * (zoom > 0 ? zoom : 1);
  return Math.round(-dy / perStep);
}

/**
 * `score` with one event's pitch replaced.
 *
 * Structurally shared: every track, measure and voice the note is not in is
 * returned by reference, so a preview rebuild costs a handful of allocations
 * rather than a copy of the score. That matters because this runs while the
 * pointer is down.
 */
export function scoreWithPitch(
  score: Score,
  eventId: string,
  pitch: Pitch
): Score {
  let found = false;

  const tracks = score.tracks.map(track => {
    if (found) return track;

    const measures = track.measures.map(measure => {
      if (found) return measure;

      const voices = measure.voices.map(voice => {
        if (found || !voice.events.some(event => event.id === eventId))
          return voice;
        found = true;
        return {
          ...voice,
          events: voice.events.map(event =>
            event.id === eventId && 'pitch' in event
              ? { ...event, pitch }
              : event
          ),
        };
      });

      return voices === measure.voices ? measure : { ...measure, voices };
    });

    return measures === track.measures ? track : { ...track, measures };
  });

  return found ? { ...score, tracks } : score;
}
