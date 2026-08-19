/**
 * Flattening a score into the notes that actually sound.
 *
 * One traversal, shared by live playback (`playbackPlan`) and offline audio
 * export (`renderEvents`). They used to walk the score separately, and drifted:
 * playback joined tied notes into one sustained note while the export
 * re-articulated every tied segment — so a tie sounded once on screen and
 * twice in the file, against `renderEvents`' own promise to match "what you
 * just heard".
 *
 * Ticks, not seconds: a tempo is the caller's concern. Live playback keeps
 * ticks and hands the engine a `TempoConversion`; the offline renderer
 * converts, because a rendered file has no tempo map to consult.
 *
 * Mute and solo are *not* applied here either. The export drops silenced
 * tracks' notes, while playback keeps them and lets the engine mix live — the
 * whole reason `applyMix` exists.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type { MusicalEvent, Score, Track } from '@sudobility/music_types';
import { pitchToMidi } from '../pitch/pitch.js';
import { joinTiedNotes } from './ties.js';

/**
 * One sounding note, in score ticks, with the ids it came from.
 *
 * Structurally `PlaybackNote` in music_types, which is what the engine takes —
 * so a `FlatNote[]` is assignable to it with no mapping step. Declared here
 * rather than imported because this is domain data: a note the score sounds,
 * independent of who is going to play it.
 */
export type FlatNote = {
  tick: number;
  durTicks: number;
  midi: number;
  /** As stored on the event, 0-127. Callers that want 0..1 divide. */
  velocity: number;
  trackId: string;
  noteId: string;
};

/**
 * Every voice-ordinal channel of a track: across all measures in tick order,
 * the events at that ordinal position.
 *
 * Voice ids are not stable across a barline, so the ordinal stands in for "the
 * same voice" from bar to bar — which is what lets `joinTiedNotes` see a tie
 * that crosses one. `ties.ts` exports a `voiceChannel`, but that takes a single
 * ordinal and returns measure-annotated notes for tie-*partner* lookup, where
 * this needs every ordinal at once with rests included.
 */
export function trackVoiceChannels(track: Track): MusicalEvent[][] {
  const maxVoices = track.measures.reduce(
    (max, m) => Math.max(max, m.voices.length),
    0
  );
  const channels: MusicalEvent[][] = [];
  for (let voiceIndex = 0; voiceIndex < maxVoices; voiceIndex += 1) {
    const channel: MusicalEvent[] = [];
    for (const measure of track.measures) {
      const voice = measure.voices[voiceIndex];
      if (voice) channel.push(...voice.events);
    }
    channel.sort((a, b) => a.startTick - b.startTick);
    channels.push(channel);
  }
  return channels;
}

/** Every note the score sounds, ties joined, in tick order. */
export function flattenScoreNotes(score: Score): FlatNote[] {
  const notes: FlatNote[] = [];
  for (const track of score.tracks) {
    for (const channel of trackVoiceChannels(track)) {
      for (const event of joinTiedNotes(channel)) {
        if (!isNoteEvent(event)) continue;
        notes.push({
          tick: event.startTick,
          durTicks: event.durationTicks,
          midi: pitchToMidi(event.pitch),
          velocity: event.velocity,
          trackId: track.id,
          noteId: event.id,
        });
      }
    }
  }
  return notes.sort((a, b) => a.tick - b.tick);
}
