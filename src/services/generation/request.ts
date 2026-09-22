import {
  createEmptyScore,
  generateScoreStyleSettings,
  generateScoreRequestSchema,
  GENERATE_SCORE_STYLE_PRESETS,
  instrumentChoiceFor,
  isVocalInstrumentValue,
  measuresForSeconds,
  SONG_SECONDS,
  styleTempoRange,
  type GenerateScoreRequest,
  type GenerateScoreRequestDraft,
  type GenerateScoreRequestTrack,
  type GenerateScoreStyleSetting,
  type GenerateTrackRequest,
  type InstrumentValueEntry,
  type InstrumentChoice,
  type KeySignature,
  type NewProjectDraft,
  type ReplacementRegion,
  type StyleRosterEntry,
  type Score,
} from '@sudobility/music_types';

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
 * How many of a style's optional instruments each roster draws by default.
 *
 * None. It was 2, which took the average default ensemble from 4.6 parts to
 * 6.5, and every part is written in its own calls, so the two colour
 * instruments were ~29% of what a generation spent — on parts nobody asked
 * for, some of them unusual for the style. A roster is now exactly what the
 * style needs (`essential`) and what it is usually played with (`preferred`).
 *
 * The `optional` pools stay in the presets and `styleRoster` still draws from
 * them when a caller passes `optionalPicks`, so bringing colour back is a
 * decision at the call site or a one-line change here, not a rebuild.
 */
export const STYLE_OPTIONAL_PICKS = 0;

/**
 * The ensemble a style starts from: its essential instruments, its preferred
 * ones, and `optionalPicks` of its optional ones chosen at random (none by
 * default; see `STYLE_OPTIONAL_PICKS`).
 *
 * It used to be the preset's one list plus a single "guest" drawn from a pool
 * shared by every genre, and every entry was removable — so a reggae roster
 * could lose its kit, which is a reggae with no one-drop. The tiers say what a
 * style cannot be without (`essential`, which the dialogs refuse to remove),
 * what it is usually played with (`preferred`), and what colours it
 * (`optional`, drawn fresh each time, so two pieces of one style are not the
 * same band twice).
 *
 * `voice` says whether a singer may be added: only when the model writes the
 * music. A duplicate of anything already in the roster is never drawn, by
 * program or by the same instrument under another General MIDI name.
 *
 * Ordered the way a lead sheet reads: the singer, then melodic parts, then
 * bass-clef parts, then percussion — the first melodic track is the one the
 * dialogs label as carrying the melody. `rng` is injectable so a test can pin
 * the draw. An unknown style has no roster.
 */
export function styleRoster(
  style: string,
  options: { voice: boolean; optionalPicks?: number },
  rng: () => number = Math.random
): StyleRosterEntry[] {
  const preset = GENERATE_SCORE_STYLE_PRESETS[style];
  if (!preset) return [];
  const allowed = (value: string): boolean =>
    options.voice || !isVocalInstrumentValue(value);
  const chosen: StyleRosterEntry[] = [
    ...preset.essential.map(value => ({ value, tier: 'essential' as const })),
    ...preset.preferred
      .filter(allowed)
      .map(value => ({ value, tier: 'preferred' as const })),
  ];
  const pool = [...preset.optional].filter(allowed);
  const picks = options.optionalPicks ?? STYLE_OPTIONAL_PICKS;
  for (let pick = 0; pick < picks && pool.length > 0; pick += 1) {
    const taken = alsoTaken(new Set(chosen.map(entry => entry.value)));
    const available = pool.filter(value => !taken.has(value));
    if (available.length === 0) break;
    const value =
      available[Math.floor(rng() * available.length) % available.length];
    chosen.push({ value, tier: 'optional' });
    pool.splice(pool.indexOf(value), 1);
  }
  const rank = (value: string): number => {
    if (isVocalInstrumentValue(value)) return 0;
    const clef = instrumentChoiceFor(value).clef;
    return clef === 'percussion' ? 3 : clef === 'bass' ? 2 : 1;
  };
  // Stable, so each tier keeps its written order within a rank.
  return chosen
    .map((entry, index) => ({ entry, index }))
    .sort(
      (x, y) => rank(x.entry.value) - rank(y.entry.value) || x.index - y.index
    )
    .map(({ entry }) => entry);
}

/**
 * A key this style is actually played in, chosen fresh each time.
 *
 * Every score this app generated was in C, and not because a model preferred
 * it: the New Project dialog initialised the key to `fifths: 0` and a style
 * only ever overwrote the MODE, so the request pinned C on every genre and the
 * plan prompt dutifully bound the chart to it. Measured across every stored
 * project: `fifths` was 0 in all of them. Two genres in one key, played by
 * rosters that overlap, sound like each other however different their rhythms
 * are — and the rhythms measurably were.
 *
 * Chosen HERE and shown in the dialog rather than decided on the server, so
 * the reader sees the key before generating and can change it — the same shape
 * as the guest instrument above, which is picked here and rendered into an
 * editable list.
 *
 * `rng` is injectable so a test can pin the choice; nothing but a test passes
 * it. Null for a style with no keys of its own, which leaves whatever the
 * reader had chosen alone.
 */
export function styleKey(
  style: string,
  rng: () => number = Math.random
): KeySignature | null {
  const preset = GENERATE_SCORE_STYLE_PRESETS[style];
  const keys = preset?.keys;
  if (!preset || !keys || keys.length === 0) return null;
  const fifths = keys[Math.floor(rng() * keys.length) % keys.length];
  // The mode is the preset's, so a minor genre's `0` is A minor rather than C
  // major: the list above is tonics *within* the mode the style declares.
  return { fifths, mode: preset.mode ?? 'major' };
}

/**
 * A tempo this style is played at, and the bars a song of that length needs.
 *
 * The two travel together because the bar count is DERIVED from the tempo:
 * `measures` on the preset is "how many bars fill three and a half minutes at
 * this speed", so picking a tempo without recomputing it makes a faster piece
 * a shorter one. Returning both is what stops a caller from setting one and
 * forgetting the other — which is what a dialog with two fields invites.
 *
 * The tempo itself varies per generation for the reason the key and the guest
 * instrument do: every score of a genre ran at exactly its nominal tempo, so
 * two goes at salsa were both at 190, and sameness is cumulative.
 *
 * `rng` is injectable so a test can pin the choice; nothing but a test passes
 * it. Null for a style with no preset, which leaves the fields alone.
 */
export function styleTempo(
  style: string,
  rng: () => number = Math.random
): { tempo: number; measures: number } | null {
  const preset = GENERATE_SCORE_STYLE_PRESETS[style];
  const range = styleTempoRange(style);
  if (!preset || !range) return null;
  const [min, max] = range;
  const tempo = min + Math.floor(rng() * (max - min + 1));
  const [beats] = preset.timeSignature.split('/');
  return {
    tempo,
    measures: measuresForSeconds(
      preset.seconds ?? SONG_SECONDS.typical,
      tempo,
      Number(beats) || 4,
      preset.formBars
    ),
  };
}

/** The backend-owned tempo limits for a known style, or no limits for custom styles. */
export function styleTempoBounds(
  style: string | undefined
): readonly [number, number] | null {
  return style ? styleTempoRange(style) : null;
}

const STYLE_SETTINGS = generateScoreStyleSettings();

/** Shared style controls for a known style, or null for a custom style. */
export function styleGenerationSettings(
  style: string | undefined
): GenerateScoreStyleSetting | null {
  return style && Object.prototype.hasOwnProperty.call(STYLE_SETTINGS, style)
    ? (STYLE_SETTINGS[style] ?? null)
    : null;
}

/** Whether a manually supplied tempo is valid for the selected style. */
export function tempoAllowedForStyle(
  style: string | undefined,
  tempo: number | undefined
): boolean {
  if (tempo === undefined) return true;
  const range = styleTempoBounds(style);
  return !range || (tempo >= range[0] && tempo <= range[1]);
}

function timeSignatureMatches(
  timeSignature: GenerateScoreRequestDraft['timeSignature'],
  expected: string
): boolean {
  if (!timeSignature) return true;
  const [numerator, denominator] = expected.split('/').map(Number);
  return (
    timeSignature.numerator === numerator &&
    timeSignature.denominator === denominator
  );
}

/** Whether a request draft respects all documented controls for its style. */
export function styleSettingsAllowDraft(
  draft: Pick<
    GenerateScoreRequestDraft,
    'style' | 'tempoText' | 'timeSignature' | 'keySignature'
  >
): boolean {
  const settings = styleGenerationSettings(draft.style);
  if (!settings) return true;
  const tempo = parseOptionalPositiveTempo(draft.tempoText);
  if (
    !tempoAllowedForStyle(draft.style, tempo ?? undefined) ||
    (draft.keySignature &&
      (!settings.keys.includes(draft.keySignature.fifths) ||
        (settings.mode && draft.keySignature.mode !== settings.mode))) ||
    !timeSignatureMatches(draft.timeSignature, settings.timeSignature)
  ) {
    return false;
  }
  return true;
}

export const DEFAULT_GENERATE_SCORE_MEASURES = 8;

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

/**
 * The credits a Replace will cost: the bars the region touches, times its
 * tracks.
 *
 * The same arithmetic the server bills by — a job is charged per bar per track
 * of what it generated, and a replaced region comes back as whole bars on each
 * of its tracks, so a Replace Notes spanning part of two bars is two bars. An
 * upper bound for the same reason the Generate quote is one.
 */
export function estimateReplacementCredits(
  score: Score,
  region: ReplacementRegion
): number {
  const { startTick, endTick, trackIds } = region.range;
  const track =
    score.tracks.find(candidate => candidate.id === trackIds[0]) ??
    score.tracks[0];
  if (!track) return 0;
  const bars = track.measures.filter(
    measure =>
      measure.startTick < endTick &&
      measure.startTick + measure.durationTicks > startTick
  ).length;
  return estimateGenerateScoreCredits(bars, trackIds.length);
}

/** The credits generating one more track costs: every bar of the score, once. */
export function estimateGenerateTrackCredits(score: Score): number {
  const bars = Math.max(0, ...score.tracks.map(track => track.measures.length));
  return estimateGenerateScoreCredits(bars, 1);
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
    tempo === null ||
    !tempoAllowedForStyle(draft.style, tempo ?? undefined) ||
    !styleSettingsAllowDraft(draft)
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
      Words, but only where there is a mouth to sing them — and a subject for
      them only alongside the words themselves.

      The server writes a lyric onto the sung tracks and onto nothing else, so a
      request asking for words over an entirely instrumental roster describes an
      outcome it cannot get, and a theme without them describes a lyric nobody
      asked for. Both are gated here rather than at the two call sites, so the
      apps cannot disagree about it and a roster edited down to instruments
      after the switch was set does not quietly keep asking.
    */
    ...(draft.lyrics === true && hasVocalInstrument(draft.instrumentValues)
      ? {
          lyrics: true as const,
          ...(draft.lyricsTheme?.trim()
            ? { lyricsTheme: draft.lyricsTheme.trim() }
            : {}),
        }
      : {}),
    ...(tempo === undefined ? {} : { tempo }),
  };

  return generateScoreRequestSchema.safeParse(request).success ? request : null;
}

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
    tempo === null ||
    !styleSettingsAllowDraft(draft)
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
