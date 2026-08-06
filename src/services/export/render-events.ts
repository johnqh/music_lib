/**
 * A score flattened into timed events, ready for an offline audio render.
 *
 * Deliberately score-in, events-out: the actual rendering needs Tone.js and an
 * audio context, so it lives in music_io. Everything *musical* about an export
 * — which tracks sound, when each note starts, how long the file has to be —
 * is decided here, where it can be tested without a browser.
 */
import { TempoMap } from '../../domain/time/tempo-map.js';
import { isNoteEvent } from '@sudobility/music_types';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import type { Score } from '@sudobility/music_types';

export type RenderEvent = {
  midi: number;
  startSec: number;
  durationSec: number;
  /** 0..1, as the synth voices expect. */
  velocity: number;
  midiProgram: number;
  isPercussion: boolean;
};

export type RenderPlan = {
  events: RenderEvent[];
  /** How long the rendered file must be, including the tail of the last note. */
  durationSec: number;
};

/** MIDI channel 10 (index 9) is the percussion channel, by convention. */
const PERCUSSION_CHANNEL = 9;
/** Release tail, so the last note is not cut off mid-decay. */
const TAIL_SEC = 1;

/**
 * The events an export should sound.
 *
 * **Mute and solo are respected**, because they are part of how the score
 * currently sounds, and an export that ignored them would not match what you
 * just heard. Solo wins: if anything is soloed, only soloed tracks sound.
 */
export function renderEvents(score: Score): RenderPlan {
  const tempoMap = new TempoMap(score.tempoMap, score.ppq);
  const anySolo = score.tracks.some((t) => t.solo);

  const events: RenderEvent[] = [];
  for (const track of score.tracks) {
    if (anySolo ? !track.solo : track.muted) continue;

    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (!isNoteEvent(event)) continue;
          const startSec = tempoMap.ticksToSeconds(event.startTick);
          const endSec = tempoMap.ticksToSeconds(event.startTick + event.durationTicks);
          events.push({
            midi: pitchToMidi(event.pitch),
            startSec,
            // Never zero: a rounding error should not silence a note.
            durationSec: Math.max(0.01, endSec - startSec),
            velocity: event.velocity / 127,
            midiProgram: track.midiProgram,
            isPercussion: track.midiChannel === PERCUSSION_CHANNEL,
          });
        }
      }
    }
  }

  events.sort((a, b) => a.startSec - b.startSec);
  const lastEnd = events.reduce((max, e) => Math.max(max, e.startSec + e.durationSec), 0);
  return { events, durationSec: lastEnd + TAIL_SEC };
}
