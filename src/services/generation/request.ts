import {
  generateScoreRequestSchema,
  instrumentChoiceFor,
  type GenerateScoreRequest,
  type GenerateScoreRequestTrack,
  type InstrumentChoice,
  type KeySignature,
  type Score,
  type TimeSignature,
} from '@sudobility/music_types';

/**
 * The shape `POST /jobs` wants for a `generate-track` job.
 *
 * Structurally a `GenerateScoreRequest` with exactly one track — the server
 * treats it the same way and appends the result rather than replacing the
 * score.
 */
export type GenerateTrackRequest = GenerateScoreRequest;

export type GenerateScoreComplexity = NonNullable<
  GenerateScoreRequest['complexity']
>;

/**
 * The keyword values the generation prompt parser branches on. An explicit
 * style or mood request only changes generation behavior when it matches one.
 *
 * Values, not labels: these are matched against the prompt, so they are data
 * this library owns. What a reader *sees* for each one is the host's, like
 * every other user-facing string here — a Chinese reader should not be shown
 * "upbeat" because that is the token the parser happens to look for.
 */
export const GENERATE_SCORE_STYLE_OPTIONS: readonly string[] = [
  'waltz',
  'jazz',
  'pop',
  'cinematic',
  'ambient',
  'battle',
];

export const GENERATE_SCORE_MOOD_OPTIONS: readonly string[] = [
  'gentle',
  'dark',
  'upbeat',
  'dramatic',
  'calm',
  'energetic',
];

export const GENERATE_SCORE_COMPLEXITY_OPTIONS = [
  'simple',
  'moderate',
  'complex',
] as const satisfies readonly GenerateScoreComplexity[];

export type GenerateScoreKeyFifthsOption = { fifths: number; label: string };

/** Fifths -7..7, labeled by major-key tonic. The separate mode field supplies major/minor. */
export const GENERATE_SCORE_KEY_FIFTHS_OPTIONS: readonly GenerateScoreKeyFifthsOption[] =
  [
    { fifths: -7, label: 'Cb' },
    { fifths: -6, label: 'Gb' },
    { fifths: -5, label: 'Db' },
    { fifths: -4, label: 'Ab' },
    { fifths: -3, label: 'Eb' },
    { fifths: -2, label: 'Bb' },
    { fifths: -1, label: 'F' },
    { fifths: 0, label: 'C' },
    { fifths: 1, label: 'G' },
    { fifths: 2, label: 'D' },
    { fifths: 3, label: 'A' },
    { fifths: 4, label: 'E' },
    { fifths: 5, label: 'B' },
    { fifths: 6, label: 'F#' },
    { fifths: 7, label: 'C#' },
  ];

export const GENERATE_SCORE_TIME_SIGNATURE_OPTIONS: Record<
  string,
  TimeSignature
> = {
  '4/4': { numerator: 4, denominator: 4 },
  '3/4': { numerator: 3, denominator: 4 },
  '2/4': { numerator: 2, denominator: 4 },
  '6/8': { numerator: 6, denominator: 8 },
  '5/4': { numerator: 5, denominator: 4 },
  '7/8': { numerator: 7, denominator: 8 },
};

export const DEFAULT_GENERATE_SCORE_MEASURES = 8;

export type GenerateScoreRequestDraft = {
  title?: string;
  prompt: string;
  durationMeasures: number;
  instrumentValues: readonly string[];
  complexity?: GenerateScoreComplexity;
  timeSignature?: TimeSignature;
  keySignature?: KeySignature;
  style?: string;
  mood?: string;
  tempoText?: string;
};

export type InstrumentValueEntry = { id: number; value: string };

export function generateScoreTrackForInstrumentValue(
  value: string
): GenerateScoreRequestTrack {
  const choice = instrumentChoiceFor(value);
  return {
    name: choice.instrumentName,
    instrumentName: choice.instrumentName,
    midiProgram: choice.midiProgram,
    clef: choice.clef,
  };
}

export function estimateGenerateScoreCredits(
  durationMeasures: number,
  trackCount: number
): number {
  if (!Number.isInteger(durationMeasures) || durationMeasures <= 0) return 0;
  return durationMeasures * Math.max(0, trackCount);
}

export function firstMelodyInstrumentEntryId(
  entries: readonly InstrumentValueEntry[]
): number | undefined {
  return entries.find(
    entry => instrumentChoiceFor(entry.value).clef !== 'percussion'
  )?.id;
}

export function canBuildGenerateScoreRequest(
  draft: GenerateScoreRequestDraft
): boolean {
  return buildGenerateScoreRequest(draft) !== null;
}

export function buildGenerateScoreRequest(
  draft: GenerateScoreRequestDraft
): GenerateScoreRequest | null {
  const tempo = parseOptionalPositiveTempo(draft.tempoText);
  if (
    draft.prompt.trim() === '' ||
    !Number.isInteger(draft.durationMeasures) ||
    draft.durationMeasures <= 0 ||
    draft.instrumentValues.length === 0 ||
    tempo === null
  ) {
    return null;
  }

  const title = draft.title?.trim();
  const request: GenerateScoreRequest = {
    prompt: draft.prompt,
    ...(title ? { title } : {}),
    durationMeasures: draft.durationMeasures,
    tracks: draft.instrumentValues.map(generateScoreTrackForInstrumentValue),
    ...(draft.complexity ? { complexity: draft.complexity } : {}),
    ...(draft.timeSignature ? { timeSignature: draft.timeSignature } : {}),
    ...(draft.keySignature ? { keySignature: draft.keySignature } : {}),
    ...(draft.style ? { style: draft.style } : {}),
    ...(draft.mood ? { mood: draft.mood } : {}),
    ...(tempo === undefined ? {} : { tempo }),
  };

  return generateScoreRequestSchema.safeParse(request).success ? request : null;
}

function parseOptionalPositiveTempo(
  value: string | undefined
): number | null | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return undefined;
  const tempo = Number(trimmed);
  return Number.isFinite(tempo) && tempo > 0 ? tempo : null;
}

/**
 * The request that adds one generated track to an open score.
 *
 * Everything but the prompt and the instrument is **taken from the score**, and
 * has to be: a track generated at a different length, time signature, key or
 * tempo does not line up with the music it is meant to accompany, and the
 * result is unusable rather than merely different. That is the whole reason
 * this is a function over a `Score` and not a form.
 *
 * `clef` comes from the instrument *choice* rather than from its program: a
 * drum kit is not a GM program — kit 40 is Brush where program 40 is Violin —
 * so the percussion clef is the only thing that tells the two apart.
 */
export function buildGenerateTrackRequest(
  score: Score,
  prompt: string,
  instrument: InstrumentChoice
): GenerateTrackRequest {
  const first = score.tracks[0];
  const { midiProgram, instrumentName, clef } = instrument;
  return {
    prompt,
    durationMeasures: first?.measures.length ?? DEFAULT_GENERATED_MEASURES,
    ...(first?.measures[0]
      ? {
          timeSignature: first.measures[0].timeSignature,
          keySignature: first.measures[0].keySignature,
        }
      : {}),
    ...(score.tempoMap[0] ? { tempo: score.tempoMap[0].bpm } : {}),
    tracks: [{ name: instrumentName, instrumentName, midiProgram, clef }],
  };
}

/**
 * How long a generated track is when the score has no first track to match.
 *
 * Only reachable for a score with no tracks at all, which the editor does not
 * produce — but a length has to come from somewhere, and eight bars is what a
 * new score here is.
 */
const DEFAULT_GENERATED_MEASURES = 8;
