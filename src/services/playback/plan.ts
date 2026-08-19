/**
 * Everything live playback needs, decided here rather than in the engine.
 *
 * The live counterpart of `renderEvents`, and the reason music_io needs no
 * musical code at all: ties are joined, pitches resolved, the measure grid's
 * beats read off, the GM voice resolved and the tempo handed over as a
 * conversion. The engine schedules and sounds; it decides nothing.
 *
 * This is `schedule.ts` from music_io, moved to where its imports already
 * lived. The note traversal itself is `flattenScoreNotes`, shared with
 * `renderEvents` so live and offline cannot drift over ties again.
 */
import type {
  AuditionVoice,
  MetronomeClick,
  PlaybackPlan,
  PlaybackTrack,
  Score,
} from '@sudobility/music_types';
import { TempoMap } from '../../domain/time/tempo-map.js';
import { flattenScoreNotes } from '../../domain/score/flatten.js';
import { beatBoundaries } from '../../domain/time/ticks.js';
import { gmInstrument } from '../../domain/instruments/gm.js';
import { gmKitAt } from '../../domain/instruments/gm-kit.js';
import { isPercussionTrack } from '../../domain/instruments/track-instrument.js';

/**
 * The GM voice a program addresses.
 *
 * The one place the kit-versus-instrument distinction is resolved, shared by
 * the plan and by auditioning. A percussion track's `midiProgram` is a *kit*
 * address — `gmKitAt` maps any address to the kit whose region contains it, so
 * a score that arrives at a program GM defines no kit at still plays — and the
 * name must be the kit's, because `gmInstrument(40)` is Violin where kit 40 is
 * Brush.
 */
export function resolveVoice(
  program: number,
  isPercussion: boolean,
  fallbackName = ''
): AuditionVoice {
  if (isPercussion) {
    const kit = gmKitAt(program);
    return { program: kit.program, name: kit.name, isPercussion: true };
  }
  return {
    program,
    name: gmInstrument(program)?.name ?? fallbackName,
    isPercussion: false,
  };
}

/**
 * The tracks alone.
 *
 * Separate from `playbackPlan` because a mix change while playing must not
 * rebuild every note — `PlaybackEngine.applyMix` takes only this.
 */
export function playbackTracks(score: Score): PlaybackTrack[] {
  return score.tracks.map(track => {
    const percussion = isPercussionTrack(track);
    const voice = resolveVoice(
      track.midiProgram,
      percussion,
      track.instrumentName
    );
    return {
      id: track.id,
      midiProgram: track.midiProgram,
      instrumentName: track.instrumentName,
      isPercussion: percussion,
      volume: track.volume,
      pan: track.pan,
      muted: track.muted,
      solo: track.solo,
      voiceProgram: voice.program,
      voiceName: voice.name,
    };
  });
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
  const notes = flattenScoreNotes(score);
  return {
    tracks: playbackTracks(score),
    notes,
    clicks: metronomeClicks(score),
    // `TempoMap` satisfies `TempoConversion` structurally, so nothing converts twice.
    tempo: new TempoMap(score.tempoMap, score.ppq),
    durationTicks: notes.reduce(
      (n, note) => Math.max(n, note.tick + note.durTicks),
      0
    ),
  };
}
