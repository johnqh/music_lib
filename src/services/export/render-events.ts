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

import type { RenderEvent, RenderPlan, RenderTrack } from '@sudobility/music_types';
export type { RenderEvent, RenderPlan, RenderTrack } from '@sudobility/music_types';

/** Release tail, so the last note is not cut off mid-decay. */
const TAIL_SEC = 1;

/**
 * The plan an export should sound, matching live playback.
 *
 * **Mute and solo are respected**, because they are part of how the score
 * currently sounds, and an export that ignored them would not match what you
 * just heard. Solo wins: if anything is soloed, only soloed tracks sound.
 *
 * Every track appears in `tracks` regardless — silent, muted, soloed away —
 * because the renderer sizes its mix headroom by how many channels exist, as
 * playback does. Only a track's *notes* are dropped when it is silenced.
 *
 * `isPercussion` comes from the clef and not the MIDI channel, and the voice is
 * left for the renderer to resolve from `midiProgram`/`instrumentName`: both
 * are the signals live playback uses, and the export sounding different from
 * the thing it is an export *of* is the bug being fixed here.
 */
export function renderEvents(score: Score): RenderPlan {
  const tempoMap = new TempoMap(score.tempoMap, score.ppq);
  const anySolo = score.tracks.some((t) => t.solo);

  const tracks: RenderTrack[] = score.tracks.map((track) => ({
    id: track.id,
    midiProgram: track.midiProgram,
    instrumentName: track.instrumentName,
    isPercussion: track.clef === 'percussion',
    volume: track.volume,
    pan: track.pan,
  }));

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
            trackId: track.id,
            midi: pitchToMidi(event.pitch),
            startSec,
            // Never zero: a rounding error should not silence a note.
            durationSec: Math.max(0.01, endSec - startSec),
            velocity: event.velocity / 127,
          });
        }
      }
    }
  }

  events.sort((a, b) => a.startSec - b.startSec);
  const lastEnd = events.reduce((max, e) => Math.max(max, e.startSec + e.durationSec), 0);
  return { tracks, events, durationSec: lastEnd + TAIL_SEC };
}
