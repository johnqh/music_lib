/**
 * Deterministic seeded mock `MusicGenerationProvider` (spec §11, §31):
 * builds full scores from a `GenerateScoreRequest` (melody/chords/bass/
 * drums assembled via `patterns/*`) and regenerates selected regions into
 * 1-N candidate fragments via seeded, instruction-keyword-driven
 * transforms (`mock-transforms.ts`). No network calls, no LLM — repeatable
 * output from a seed, with the seed configurable via developer settings
 * (spec §33).
 */
import type { KeySignature, Score, TimeSignature, Track } from '@sudobility/music_types';
import { validateScore } from '../../domain/validation/validator';
import { generateScoreRequestSchema, regenerateRegionRequestSchema } from '@sudobility/music_types';
import type {
  GenerateScoreRequest,
  GenerateScoreRequestTrack,
  GenerateScoreResult,
  MusicGenerationProvider,
  RegenerateRegionRequest,
  RegenerateRegionResult,
  RegenerationCandidate,
} from '@sudobility/music_types';
import type { ProgressionName } from './music-theory';
import { clampPitchToMidiRange } from './music-theory';
import { SeededRng } from './prng';
import { parsePrompt } from './prompt-parse';
import type { PromptHints } from './prompt-parse';
import type { AccompanimentStyle } from './patterns/accompaniment';
import { generateAccompaniment } from './patterns/accompaniment';
import type { BassStyle } from './patterns/bass';
import { generateBass } from './patterns/bass';
import { generateDrums } from './patterns/drums';
import { generateMelody } from './patterns/melody';
import type { Step } from './patterns/shared';
import { buildMeasuresFromSteps } from './patterns/shared';
import { transformFragment } from './mock-transforms';

const DEFAULT_SEED = 'scoresmith-mock';
const DEFAULT_PPQ = 480;
const DEFAULT_TIME_SIGNATURE: TimeSignature = { numerator: 4, denominator: 4 };
const DEFAULT_KEY_SIGNATURE: KeySignature = { fifths: 0, mode: 'major' };
const DEFAULT_TEMPO = 120;
const DEFAULT_TRACK: GenerateScoreRequestTrack = {
  name: 'Piano',
  instrumentName: 'Piano',
  midiProgram: 0,
  clef: 'treble',
};

/**
 * Generated-score metadata timestamps are a fixed placeholder (not
 * `Date.now()`): a real wall-clock timestamp would make "same seed+request
 * ⇒ deep-equal scores" fail whenever the two calls happen in different
 * milliseconds. The app layer (persistence/store, later tasks) is expected
 * to overwrite `metadata.createdAt`/`updatedAt` with the real time when a
 * generated score is actually adopted into a project.
 */
const GENERATION_TIMESTAMP = new Date(0).toISOString();

type TrackRole = 'melody' | 'harmony' | 'bass' | 'drums';

/** First treble-clef track (or one named/instrumented "melody") gets the melody; percussion/"drum" tracks get a groove; bass-clef/"bass" tracks get a bass line; everything else gets chordal accompaniment. */
function classifyTrackRole(def: GenerateScoreRequestTrack, melodyAlreadyAssigned: boolean): TrackRole {
  const name = `${def.name} ${def.instrumentName}`.toLowerCase();
  if (def.clef === 'percussion' || name.includes('drum') || name.includes('percussion')) return 'drums';
  if (def.clef === 'bass' || name.includes('bass')) return 'bass';
  if (def.clef === 'treble' && !melodyAlreadyAssigned) return 'melody';
  return 'harmony';
}

function progressionForHints(key: KeySignature, hints: PromptHints): ProgressionName {
  if (hints.style === 'jazz') return 'ii-V-I';
  if (hints.style === 'waltz') return 'I-vi-IV-V';
  if (hints.style === 'battle' || hints.mood === 'dark') return key.mode === 'minor' ? 'i-VI-III-VII' : 'I-V-vi-IV';
  if (key.mode === 'minor') return 'i-VI-III-VII';
  return 'I-V-vi-IV';
}

type Complexity = NonNullable<GenerateScoreRequest['complexity']>;

function accompanimentStyleFor(complexity: Complexity, hints: PromptHints): AccompanimentStyle {
  if (hints.style === 'jazz' || complexity === 'complex') return 'arpeggio';
  if (complexity === 'simple') return 'blockChords';
  return 'alberti';
}

function bassStyleFor(complexity: Complexity, hints: PromptHints): BassStyle {
  return complexity === 'simple' && hints.style !== 'jazz' ? 'roots' : 'walking';
}

/** Octave whose C..B span roughly centers `range` (falls back to `fallback` when no range is given). */
function centerOctaveForRange(range: { lowestMidi: number; highestMidi: number } | undefined, fallback: number): number {
  if (!range) return fallback;
  const midpoint = (range.lowestMidi + range.highestMidi) / 2;
  return Math.round(midpoint / 12) - 1;
}

/** Applies a request track's `range`/`maximumPolyphony` to generated pattern steps. */
function applyTrackConstraints(measures: Step[][], def: GenerateScoreRequestTrack): Step[][] {
  return measures.map((steps) =>
    steps.map((step) => {
      let pitches = step.pitches.map((p) => clampPitchToMidiRange(p, def.range));
      if (def.maximumPolyphony !== undefined && pitches.length > def.maximumPolyphony) {
        pitches = pitches.slice(0, def.maximumPolyphony);
      }
      return { ...step, pitches };
    }),
  );
}

type TrackGenerationContext = {
  rng: SeededRng;
  key: KeySignature;
  timeSignature: TimeSignature;
  ppq: number;
  measureCount: number;
  complexity: Complexity;
  progression: ProgressionName;
  hints: PromptHints;
};

function generateTrackSteps(role: TrackRole, def: GenerateScoreRequestTrack, ctx: TrackGenerationContext): Step[][] {
  if (role === 'melody') {
    return generateMelody({
      key: ctx.key,
      timeSignature: ctx.timeSignature,
      ppq: ctx.ppq,
      measureCount: ctx.measureCount,
      octave: centerOctaveForRange(def.range, 4),
      complexity: ctx.complexity,
      rng: ctx.rng,
    });
  }
  if (role === 'bass') {
    return generateBass({
      key: ctx.key,
      timeSignature: ctx.timeSignature,
      ppq: ctx.ppq,
      measureCount: ctx.measureCount,
      octave: centerOctaveForRange(def.range, 2),
      style: bassStyleFor(ctx.complexity, ctx.hints),
      progression: ctx.progression,
      rng: ctx.rng,
    });
  }
  if (role === 'drums') {
    return generateDrums({ timeSignature: ctx.timeSignature, ppq: ctx.ppq, measureCount: ctx.measureCount, groove: 'rock' });
  }
  return generateAccompaniment({
    key: ctx.key,
    timeSignature: ctx.timeSignature,
    ppq: ctx.ppq,
    measureCount: ctx.measureCount,
    octave: centerOctaveForRange(def.range, 4),
    style: accompanimentStyleFor(ctx.complexity, ctx.hints),
    progression: ctx.progression,
    rng: ctx.rng,
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

function candidateLabel(instruction: string, index: number): string {
  const trimmed = instruction.trim();
  const summary = trimmed.length > 0 ? trimmed : 'Variation';
  return `${summary} (${index + 1})`;
}

export type MockGenerationProviderOptions = { seed?: number | string };

export class MockGenerationProvider implements MusicGenerationProvider {
  readonly id = 'mock';
  readonly name = 'Seeded Mock Generator';
  private readonly seed: number | string;

  constructor(opts?: MockGenerationProviderOptions) {
    this.seed = opts?.seed ?? DEFAULT_SEED;
  }

  async generateScore(request: GenerateScoreRequest, signal?: AbortSignal): Promise<GenerateScoreResult> {
    await Promise.resolve();
    throwIfAborted(signal);

    const parsed = generateScoreRequestSchema.parse(request) as GenerateScoreRequest;
    const rng = new SeededRng(this.seed);
    const hints = parsePrompt(parsed.prompt);
    const warnings: string[] = [];

    const keySignature = parsed.keySignature ?? hints.keySignature ?? DEFAULT_KEY_SIGNATURE;
    const timeSignature =
      parsed.timeSignature ??
      hints.timeSignature ??
      (hints.style === 'waltz' ? { numerator: 3, denominator: 4 } : DEFAULT_TIME_SIGNATURE);
    const tempo = parsed.tempo ?? hints.tempo ?? DEFAULT_TEMPO;
    const complexity: Complexity = parsed.complexity ?? 'moderate';
    const trackDefs = parsed.tracks.length > 0 ? parsed.tracks : [DEFAULT_TRACK];
    const progression = progressionForHints(keySignature, hints);

    let melodyAssigned = false;
    const tracks: Track[] = trackDefs.map((def) => {
      const role = classifyTrackRole(def, melodyAssigned);
      if (role === 'melody') melodyAssigned = true;

      const trackId = rng.id('track');
      const ctx: TrackGenerationContext = {
        rng,
        key: keySignature,
        timeSignature,
        ppq: DEFAULT_PPQ,
        measureCount: parsed.durationMeasures,
        complexity,
        progression,
        hints,
      };
      const steps = applyTrackConstraints(generateTrackSteps(role, def, ctx), def);
      const measures = buildMeasuresFromSteps(steps, DEFAULT_PPQ, timeSignature, keySignature, trackId, rng);

      return {
        id: trackId,
        name: def.name,
        instrumentName: def.instrumentName,
        midiProgram: def.midiProgram,
        midiChannel: role === 'drums' ? 9 : 0,
        clef: def.clef,
        volume: 1,
        pan: 0,
        muted: false,
        solo: false,
        measures,
      };
    });

    const score: Score = {
      id: rng.id('score'),
      version: 1,
      ppq: DEFAULT_PPQ,
      metadata: {
        title: parsed.title ?? 'Generated Score',
        createdAt: GENERATION_TIMESTAMP,
        updatedAt: GENERATION_TIMESTAMP,
      },
      tempoMap: [{ id: rng.id('tempo'), tick: 0, bpm: tempo }],
      tracks,
    };

    const errors = validateScore(score).filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      throw new Error(`MockGenerationProvider produced an invalid score: ${errors.map((i) => i.message).join('; ')}`);
    }

    return { score, warnings };
  }

  async regenerateRegion(request: RegenerateRegionRequest, signal?: AbortSignal): Promise<RegenerateRegionResult> {
    await Promise.resolve();
    throwIfAborted(signal);

    const parsed = regenerateRegionRequestSchema.parse(request) as RegenerateRegionRequest;
    const warnings: string[] = [];
    const candidates: RegenerationCandidate[] = [];

    for (let index = 0; index < parsed.candidateCount; index += 1) {
      const rng = new SeededRng(`${String(this.seed)}:${index}`);
      const fragment = transformFragment(parsed.selectedFragment, parsed.instruction, parsed.constraints, rng, index);
      candidates.push({ id: rng.id('candidate'), label: candidateLabel(parsed.instruction, index), fragment });
    }

    return { candidates, warnings };
  }
}
