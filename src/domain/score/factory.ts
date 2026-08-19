import { createId } from './ids.js';
import type {
  KeySignature,
  Measure,
  Score,
  ScoreMetadata,
  TimeSignature,
  Track,
} from '@sudobility/music_types';
import { measureDurationTicks } from '../time/ticks.js';

const DEFAULT_PPQ = 480;
const DEFAULT_TEMPO_BPM = 120;
const DEFAULT_TIME_SIGNATURE: TimeSignature = { numerator: 4, denominator: 4 };
const DEFAULT_KEY_SIGNATURE: KeySignature = { fifths: 0, mode: 'major' };
const DEFAULT_MEASURE_COUNT = 1;
const DEFAULT_VOICE_NAME = 'Voice 1';

export type CreateTrackOptions = Partial<Track> & { name: string };

/** Builds a `Track` with sensible defaults, overridden by any fields in `opts`. */
export function createTrack(opts: CreateTrackOptions): Track {
  return {
    id: opts.id ?? createId(),
    name: opts.name,
    instrumentName: opts.instrumentName ?? 'Piano',
    midiProgram: opts.midiProgram ?? 0,
    midiChannel: opts.midiChannel ?? 0,
    clef: opts.clef ?? 'treble',
    volume: opts.volume ?? 1,
    pan: opts.pan ?? 0,
    muted: opts.muted ?? false,
    solo: opts.solo ?? false,
    measures: opts.measures ?? [],
  };
}

/** Builds a single fully-rested measure at the given index/startTick. */
function buildRestMeasure(
  index: number,
  startTick: number,
  timeSignature: TimeSignature,
  keySignature: KeySignature,
  durationTicks: number,
  trackId: string
): Measure {
  const voiceId = createId();
  return {
    id: createId(),
    index,
    startTick,
    durationTicks,
    timeSignature,
    keySignature,
    voices: [
      {
        id: voiceId,
        name: DEFAULT_VOICE_NAME,
        events: [
          { id: createId(), startTick, durationTicks, voiceId, trackId },
        ],
      },
    ],
  };
}

/** Builds `count` consecutive fully-rested measures starting at tick 0. */
function buildMeasures(
  count: number,
  timeSignature: TimeSignature,
  keySignature: KeySignature,
  ppq: number,
  trackId: string
): Measure[] {
  const durationTicks = measureDurationTicks(timeSignature, ppq);
  const measures: Measure[] = [];
  for (let index = 0; index < count; index += 1) {
    measures.push(
      buildRestMeasure(
        index,
        index * durationTicks,
        timeSignature,
        keySignature,
        durationTicks,
        trackId
      )
    );
  }
  return measures;
}

export type CreateEmptyScoreOptions = {
  title: string;
  ppq?: number;
  tempo?: number;
  timeSignature?: TimeSignature;
  keySignature?: KeySignature;
  measures?: number;
  tracks?: Array<Partial<Track> & { name: string }>;
};

/**
 * Builds a new `Score` with `measures` fully-rested measures on each of
 * `tracks`, one default voice per track per measure. Defaults: 480 PPQ,
 * 120 bpm, 4/4, C major, one measure, one Piano track.
 */
export function createEmptyScore(opts: CreateEmptyScoreOptions): Score {
  const ppq = opts.ppq ?? DEFAULT_PPQ;
  const timeSignature = opts.timeSignature ?? DEFAULT_TIME_SIGNATURE;
  const keySignature = opts.keySignature ?? DEFAULT_KEY_SIGNATURE;
  const measureCount = opts.measures ?? DEFAULT_MEASURE_COUNT;
  const trackOptions = opts.tracks ?? [
    { name: 'Piano', instrumentName: 'Piano', clef: 'treble' as const },
  ];

  const tracks = trackOptions.map(trackOpts => {
    const track = createTrack(trackOpts);
    return {
      ...track,
      measures: buildMeasures(
        measureCount,
        timeSignature,
        keySignature,
        ppq,
        track.id
      ),
    };
  });

  const now = new Date().toISOString();
  const metadata: ScoreMetadata = {
    title: opts.title,
    createdAt: now,
    updatedAt: now,
  };

  return {
    id: createId(),
    version: 1,
    ppq,
    metadata,
    tempoMap: [
      { id: createId(), tick: 0, bpm: opts.tempo ?? DEFAULT_TEMPO_BPM },
    ],
    tracks,
  };
}

/**
 * Appends one fully-rested measure to every track, continuing each track's
 * own tick numbering and reusing its last measure's time/key signature
 * (falling back to 4/4 C major for a track with no existing measures).
 */
export function appendMeasure(score: Score): Score {
  const tracks = score.tracks.map(track => {
    const lastMeasure = track.measures[track.measures.length - 1] as
      Measure | undefined;
    const timeSignature = lastMeasure?.timeSignature ?? DEFAULT_TIME_SIGNATURE;
    const keySignature = lastMeasure?.keySignature ?? DEFAULT_KEY_SIGNATURE;
    const durationTicks = measureDurationTicks(timeSignature, score.ppq);
    const startTick = lastMeasure
      ? lastMeasure.startTick + lastMeasure.durationTicks
      : 0;
    const newMeasure = buildRestMeasure(
      track.measures.length,
      startTick,
      timeSignature,
      keySignature,
      durationTicks,
      track.id
    );
    return { ...track, measures: [...track.measures, newMeasure] };
  });

  return {
    ...score,
    tracks,
    metadata: { ...score.metadata, updatedAt: new Date().toISOString() },
  };
}

/**
 * Recomputes `index`/`startTick` for every track's measures from their
 * current array order (each measure keeps its own `durationTicks`), and
 * shifts each measure's events by the same delta so they stay positioned
 * consistently within their (possibly moved) measure. Measures whose
 * index/startTick are already consistent are returned unchanged
 * (referentially equal) so unaffected structure is preserved.
 */
export function rebuildMeasureTicks(score: Score): Score {
  const tracks = score.tracks.map(track => {
    let cursor = 0;
    const measures = track.measures.map((measure, index) => {
      const startTick = cursor;
      const delta = startTick - measure.startTick;
      cursor += measure.durationTicks;

      if (delta === 0 && index === measure.index) {
        return measure;
      }

      const voices =
        delta === 0
          ? measure.voices
          : measure.voices.map(voice => ({
              ...voice,
              events: voice.events.map(event => ({
                ...event,
                startTick: event.startTick + delta,
              })),
            }));

      return { ...measure, index, startTick, voices };
    });
    return { ...track, measures };
  });

  return { ...score, tracks };
}
