/**
 * Everything live playback needs, decided here rather than in the engine.
 *
 * The live counterpart of `renderEvents`, and the reason music_io needs no
 * musical code at all: ties are joined, pitches resolved, the measure grid's
 * beats read off, the GM voice resolved and the tempo handed over as a
 * conversion. The engine schedules and sounds; it decides nothing.
 *
 * This is `schedule.ts` from music_io, moved to where its imports already
 * lived. `trackVoiceChannels` comes across as it stands: `ties.ts` exports a
 * `voiceChannel`, but that one takes a single voice ordinal and returns
 * measure-annotated notes for tie-partner lookup, where this needs every
 * ordinal at once with rests included — which is what `joinTiedNotes` eats.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type {
  MetronomeClick,
  MusicalEvent,
  PlaybackNote,
  PlaybackPlan,
  PlaybackTrack,
  Score,
  Track,
} from '@sudobility/music_types';
import { TempoMap } from '../../domain/time/tempo-map.js';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import { joinTiedNotes } from '../../domain/score/ties.js';
import { beatBoundaries } from '../../domain/time/ticks.js';
import { gmInstrument } from '../../domain/instruments/gm.js';
import { gmKitAt } from '../../domain/instruments/gm-kit.js';
import { isPercussionTrack } from '../../domain/instruments/track-instrument.js';

/**
 * The tracks alone.
 *
 * Separate from `playbackPlan` because a mix change while playing must not
 * rebuild every note — `PlaybackEngine.applyMix` takes only this.
 */
export function playbackTracks(score: Score): PlaybackTrack[] {
  return score.tracks.map((track) => {
    const percussion = isPercussionTrack(track);
    // A percussion track's midiProgram is a kit address, so it resolves through
    // the kit table; a pitched one is its own program.
    const voiceProgram = percussion ? gmKitAt(track.midiProgram).program : track.midiProgram;
    return {
      id: track.id,
      midiProgram: track.midiProgram,
      instrumentName: track.instrumentName,
      isPercussion: percussion,
      volume: track.volume,
      pan: track.pan,
      muted: track.muted,
      solo: track.solo,
      voiceProgram,
      // The kit's name on a percussion track, not the instrument at that
      // program: gmInstrument(40) is Violin and kit 40 is Brush. Only the
      // pitched path reads this today, but naming a drum kit "Violin" is
      // exactly the confusion `gmKitAt` exists to prevent.
      voiceName: percussion
        ? gmKitAt(track.midiProgram).name
        : (gmInstrument(voiceProgram)?.name ?? track.instrumentName),
    };
  });
}

/**
 * Every voice-ordinal channel of a track: across all measures in tick order,
 * the events at that ordinal position. Voice ids are not stable across a
 * barline, so the ordinal stands in for "the same voice" from bar to bar.
 */
function trackVoiceChannels(track: Track): MusicalEvent[][] {
  const maxVoices = track.measures.reduce((max, m) => Math.max(max, m.voices.length), 0);
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

function playbackNotes(score: Score): PlaybackNote[] {
  const notes: PlaybackNote[] = [];
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

/**
 * Every beat position across the measure grid, read off the first track —
 * every track shares one grid once `rebuildMeasureTicks` has run.
 */
function metronomeClicks(score: Score): MetronomeClick[] {
  const track = score.tracks[0];
  if (!track) return [];
  const clicks: MetronomeClick[] = [];
  for (const measure of track.measures) {
    beatBoundaries(measure.timeSignature, score.ppq).forEach((offset, i) => {
      clicks.push({ tick: measure.startTick + offset, accent: i === 0 });
    });
  }
  return clicks;
}

export function playbackPlan(score: Score): PlaybackPlan {
  const notes = playbackNotes(score);
  return {
    tracks: playbackTracks(score),
    notes,
    clicks: metronomeClicks(score),
    // `TempoMap` satisfies `TempoConversion` structurally, so nothing converts twice.
    tempo: new TempoMap(score.tempoMap, score.ppq),
    durationTicks: notes.reduce((n, note) => Math.max(n, note.tick + note.durTicks), 0),
  };
}
