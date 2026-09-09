import {
  createEmptyScore,
  generateScoreRequestSchema,
  GENERATE_SCORE_STYLE_PRESETS,
  instrumentChoiceFor,
  isVocalInstrumentValue,
  type GenerateScoreRequest,
  type GenerateScoreRequestTrack,
  type InstrumentChoice,
  type KeySignature,
  type Score,
  type TimeSignature,
} from '@sudobility/music_types';

export {
  GENERATE_SCORE_STYLE_OPTIONS,
  GENERATE_SCORE_STYLE_PRESETS,
  type GenerateScoreStylePreset,
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
 * Instruments a piece can invite in that its genre would not have asked for.
 *
 * Every generation of one style otherwise draws the same four or five
 * instruments, so sixteen bars of country are sixteen bars of country every
 * time. One guest is enough to make each attempt its own piece — a cello under
 * a metal riff, a harmonica over a house track — and because it is chosen from
 * outside the style's own roster it is the one part of the ensemble that is not
 * a foregone conclusion.
 *
 * Common instruments only, and deliberately so. These are the sounds a listener
 * can name, which is what makes the guest read as a decision rather than as a
 * patch nobody recognises: a violin is interesting over a funk groove, and
 * "Pad 6 (metallic)" is just an unfamiliar noise. They are also all instruments
 * that carry a line — a guest with nothing to play is a track of rests.
 *
 * No kits: percussion is chosen by the style, and a second drummer is not a
 * guest, it is a mess.
 */
export const GUEST_INSTRUMENTS: readonly string[] = [
  '0', //  Acoustic Grand Piano
  '11', // Vibraphone
  '21', // Accordion
  '22', // Harmonica
  '24', // Acoustic Guitar (nylon)
  '40', // Violin
  '42', // Cello
  '46', // Orchestral Harp
  '56', // Trumpet
  '60', // French Horn
  '65', // Alto Sax
  '68', // Oboe
  '71', // Clarinet
  '73', // Flute
  '105', // Banjo
];

/**
 * Programs that are the same instrument under two names.
 *
 * General MIDI lists Violin at 40 and Fiddle at 110, and they are one
 * instrument played two ways — so a country or bluegrass lineup, which already
 * has a fiddle, could draw a violin as its "guest" and be handed the part it
 * already had. Excluding by program alone cannot see that; this is the small
 * table that can, and it is deliberately small. Only genuine same-instrument
 * pairs belong here, never whole families: a nylon guitar beside a steel one is
 * a different sound, and a cello beside a violin is the entire point.
 */
const SAME_INSTRUMENT: readonly (readonly string[])[] = [
  ['40', '110'], // Violin / Fiddle
];

/** Every program that would duplicate something already in `taken`. */
function alsoTaken(taken: ReadonlySet<string>): Set<string> {
  const out = new Set(taken);
  for (const group of SAME_INSTRUMENT) {
    if (group.some(value => taken.has(value))) {
      for (const value of group) out.add(value);
    }
  }
  return out;
}

/**
 * A style's instruments, plus one guest that is not among them.
 *
 * The exclusion is exactly "not in the typical instruments for the style",
 * since a preset's roster *is* that style's typical instruments — so a banjo
 * is never offered to bluegrass and a trumpet is never doubled in a big-band
 * lineup, without a second table saying so for each of the styles.
 *
 * `rng` is injectable so a test can pin the choice; nothing but a test passes
 * it. The guest goes LAST, which is where the caller shows it: both dialogs
 * render the ensemble as an editable list, so the addition is visible before
 * anything is generated and can be removed with one tap by somebody who wanted
 * the plain lineup.
 *
 * Returns the roster unchanged for an unknown style, and when every guest is
 * already in it — there is nothing to add that would not be a duplicate, and a
 * duplicate is the bug this replaced (two tracks named "Acoustic Guitar
 * (steel)" generate as one part written twice).
 */
export function styleInstrumentsWithGuest(
  style: string,
  rng: () => number = Math.random
): readonly string[] {
  const preset = GENERATE_SCORE_STYLE_PRESETS[style];
  if (!preset) return [];
  const taken = alsoTaken(new Set(preset.instruments));
  const available = GUEST_INSTRUMENTS.filter(value => !taken.has(value));
  if (available.length === 0) return preset.instruments;
  const guest =
    available[Math.floor(rng() * available.length) % available.length];
  return [...preset.instruments, guest];
}

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
  /**
   * Whether the sung part comes back with words under it.
   *
   * Only ever reaches the wire when somebody in the roster can sing them —
   * see `buildGenerateScoreRequest`. Deliberately not inferred from the roster
   * alone: a voice program held as a wordless "ooh" pad is a different piece of
   * music from a song with a lyric, and asking is the only way to tell.
   */
  lyrics?: boolean;
};

export type InstrumentValueEntry = { id: number; value: string };

/**
 * Whether anybody in this roster is singing.
 *
 * Shared rather than written in each app because both of them ask it twice —
 * once to decide whether to offer a lyrics control at all, and once to decide
 * whether adding a voice for the reader would be adding a second one.
 */
export function hasVocalInstrument(values: readonly string[]): boolean {
  return values.some(isVocalInstrumentValue);
}

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
    /*
      The style as a phrase, not as its token.

      `draft.style` is the picker's value — `electroSwing` — and the server
      interpolates it straight into the prompt as `Style: ...`. Sent raw, the
      model was reading a variable name and guessing at the genre from it.
      `GENERATE_SCORE_STYLE_PRESETS` carries the phrase that says what the
      genre actually *is*, rhythm first, and that is what goes on the wire.

      Expanded here rather than at each call site so both apps send the same
      thing, and so a style the presets do not know still travels as itself
      rather than becoming nothing.
    */
    ...(draft.style
      ? {
          style:
            GENERATE_SCORE_STYLE_PRESETS[draft.style]?.prompt ?? draft.style,
        }
      : {}),
    ...(draft.mood ? { mood: draft.mood } : {}),
    /*
      Words, but only where there is a mouth to sing them.

      The server writes a lyric onto the sung tracks and onto nothing else, so
      a request asking for words over an entirely instrumental roster describes
      an outcome it cannot get. Gated here rather than at the two call sites so
      the apps cannot disagree about it — and so a roster edited down to
      instruments after the switch was set does not quietly keep asking.
    */
    ...(draft.lyrics === true && hasVocalInstrument(draft.instrumentValues)
      ? { lyrics: true }
      : {}),
    ...(tempo === undefined ? {} : { tempo }),
  };

  return generateScoreRequestSchema.safeParse(request).success ? request : null;
}

/**
 * The half of a New Project draft that does not involve the model.
 *
 * `GenerateScoreRequestDraft` is structurally assignable to this — it is this
 * plus `prompt`, `style`, `mood` and `complexity` — which is what lets one form
 * state feed both builders and the Generate-for-me toggle decide only which one
 * runs. Two draft types would be two shapes to keep in step for no gain.
 */
export type NewProjectDraft = {
  title?: string;
  durationMeasures: number;
  instrumentValues: readonly string[];
  timeSignature?: TimeSignature;
  keySignature?: KeySignature;
  tempoText?: string;
};

/**
 * What a New Project form asked for.
 *
 * A discriminated result rather than a request, because the same form backs a
 * server project on two dashboards and a *local document* from the macOS File
 * menu. The form decides what was asked for; the caller decides where it lands.
 */
export type NewProjectSubmission =
  | { kind: 'generate'; request: GenerateScoreRequest }
  | { kind: 'blank'; title: string; score: Score };

/**
 * The blank score an instrumentation implies.
 *
 * Validated exactly as `buildGenerateScoreRequest` is, minus the prompt — a
 * positive whole number of bars, at least one instrument, and a tempo that is
 * blank or positive — so the two modes of one form disable Create by one rule.
 *
 * Tracks come from `generateScoreTrackForInstrumentValue`, which carries
 * `midiProgram` as well as the name and clef. Building them from the name alone
 * is how a String Quartet comes back as four pianos; see `emptyScoreForRequest`
 * in music_types, which had exactly that bug.
 */
export function buildNewProjectScore(draft: NewProjectDraft): Score | null {
  const tempo = parseOptionalPositiveTempo(draft.tempoText);
  if (
    !Number.isInteger(draft.durationMeasures) ||
    draft.durationMeasures <= 0 ||
    draft.instrumentValues.length === 0 ||
    tempo === null
  ) {
    return null;
  }

  return createEmptyScore({
    title: draft.title?.trim() || 'Untitled',
    measures: draft.durationMeasures,
    tracks: draft.instrumentValues.map(generateScoreTrackForInstrumentValue),
    ...(draft.timeSignature ? { timeSignature: draft.timeSignature } : {}),
    ...(draft.keySignature ? { keySignature: draft.keySignature } : {}),
    ...(tempo === undefined ? {} : { tempo }),
  });
}

export function canBuildNewProjectScore(draft: NewProjectDraft): boolean {
  return buildNewProjectScore(draft) !== null;
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
