/**
 * The New Project form, as data and the rules that change it.
 *
 * Both apps draw this form, and until now each held its rules in component
 * state: the web dialog as a dozen `useState`s and a ref, the native sheet as a
 * hook with its own copy. The copies had already parted. Native locked "the
 * first entry of each essential value" because its roster was a `string[]` with
 * no ids, so a second kit the reader added on purpose could lock in place of the
 * style's; it took the tempo and bars straight off the preset, so every salsa
 * it started was 190bpm for 168 bars; it never set the key at all, so every
 * score it generated was in C; and it opened at sixteen bars where the web
 * opened at eight. None of those is a rendering decision, and all of them are
 * now here, once.
 *
 * **A reducer rather than a hook,** because music_lib holds no React: the web
 * dialog feeds it to `useReducer`, the native sheet can do the same, and a test
 * can drive it with no renderer at all. The draft is plain serialisable data —
 * no ref, no closure — which is also what lets the auto-added singer be tracked
 * by *entry id* inside the state rather than in a ref beside it.
 *
 * **Randomness is a parameter.** Choosing a style draws a roster, a tempo and a
 * key (see `styleRoster`, `styleTempo`, `styleKey`); `reduceNewProjectDraft`
 * takes the `rng` it draws with, so a test pins the draw and an app passes
 * nothing.
 *
 * **Words are keys.** The library holds no copy: the default title comes back as
 * a locale key (`newProjectDefaultTitleKey`), and the one place a translated
 * string is needed — the name a project gets when nothing was typed — is handed
 * in by the caller (`newProjectSubmission(draft, defaultTitle)`).
 *
 * The web dialog is the reference for every rule below.
 */
import {
  DEFAULT_INSTRUMENT_VALUE,
  DEFAULT_VOCAL_INSTRUMENT_VALUE,
  GENERATE_SCORE_TIME_SIGNATURE_OPTIONS,
  GENERATE_SCORE_STYLE_PRESETS,
  withGenerationVariant,
  type GenerateScoreRequestDraft,
  type GenerationVariant,
  type NewProjectDraftAction,
  type NewProjectEntry,
  type NewProjectFormDraft,
  type NewProjectSubmission,
} from '@sudobility/music_types';
import {
  DEFAULT_GENERATE_SCORE_MEASURES,
  buildGenerateScoreRequest,
  buildNewProjectScore,
  canBuildGenerateScoreRequest,
  canBuildNewProjectScore,
  estimateGenerateScoreCredits,
  hasVocalInstrument,
  styleKey,
  styleRoster,
  styleTempo,
} from './request.js';
import {
  barsForSeconds,
  formatDuration,
  parseDuration,
  secondsForBars,
} from './score-duration.js';

/**
 * Which backend writes the music when nobody chose.
 *
 * DeepSeek, because it is the one whose output people preferred in listening:
 * measured side by side on the same briefs, its country and metal came back
 * more recognisably in their genre and markedly less over-written than the
 * frontier model's. Every generation form in both apps opens on it — New
 * Project, Replace and Generate Track — which is exactly why it is a constant
 * rather than three string literals.
 */
export const DEFAULT_GENERATION_VARIANT: GenerationVariant = 'deepseek';

/** The meter a new project opens in. */
const DEFAULT_METER = '4/4';

/** A fresh form: a blank project for one piano, eight bars, in C major 4/4. */
export function initialNewProjectDraft(): NewProjectFormDraft {
  return {
    title: '',
    generating: false,
    prompt: '',
    style: '',
    mood: '',
    complexity: 'moderate',
    variant: DEFAULT_GENERATION_VARIANT,
    lyrics: true,
    lyricsTheme: '',
    ensemble: [{ id: 0, value: DEFAULT_INSTRUMENT_VALUE }],
    nextEntryId: 1,
    autoVocalId: null,
    measuresText: String(DEFAULT_GENERATE_SCORE_MEASURES),
    tempoText: '',
    meter: DEFAULT_METER,
    keySignature: { fifths: 0, mode: 'major' },
    durationText: formatDuration(
      secondsForBars(DEFAULT_GENERATE_SCORE_MEASURES, '')
    ),
  };
}

/**
 * The duration text for a bar count, or the current text when the count is
 * not a usable whole number — an empty Bars field mid-edit must not blank the
 * Duration beside it.
 */
function durationFor(
  draft: NewProjectFormDraft,
  measuresText: string,
  tempoText: string,
  meter: string
): string {
  const count = Number(measuresText);
  if (!Number.isInteger(count) || count <= 0) return draft.durationText;
  return formatDuration(
    secondsForBars(
      count,
      tempoText,
      GENERATE_SCORE_TIME_SIGNATURE_OPTIONS[meter]
    )
  );
}

/**
 * Apply one action to the form.
 *
 * Returns the **same object** when an action changes nothing it is allowed to
 * change — a locked row, the last row — so a `useReducer` caller skips the
 * render and a test can assert the refusal by identity.
 */
export function reduceNewProjectDraft(
  draft: NewProjectFormDraft,
  action: NewProjectDraftAction,
  rng: () => number = Math.random
): NewProjectFormDraft {
  switch (action.type) {
    case 'setTitle':
      return { ...draft, title: action.title };
    case 'setPrompt':
      return { ...draft, prompt: action.prompt };
    case 'setMood':
      return { ...draft, mood: action.mood };
    case 'setComplexity':
      return { ...draft, complexity: action.complexity };
    case 'setVariant':
      return { ...draft, variant: action.variant };
    case 'setLyrics':
      return { ...draft, lyrics: action.lyrics };
    case 'setLyricsTheme':
      return { ...draft, lyricsTheme: action.lyricsTheme };
    case 'setKey':
      return {
        ...draft,
        keySignature: { ...draft.keySignature, fifths: action.fifths },
      };
    case 'setMode':
      return {
        ...draft,
        keySignature: { ...draft.keySignature, mode: action.mode },
      };
    case 'applyStyle':
      return applyStyle(draft, action.style, rng);
    case 'setGenerating':
      return setGenerating(draft, action.generating);
    case 'addInstrument':
      return {
        ...draft,
        ensemble: [
          ...draft.ensemble,
          { id: draft.nextEntryId, value: action.value },
        ],
        nextEntryId: draft.nextEntryId + 1,
      };
    case 'removeInstrument': {
      const entry = draft.ensemble.find(row => row.id === action.id);
      if (!entry || !canRemoveNewProjectEntry(draft, entry)) return draft;
      return {
        ...draft,
        ensemble: draft.ensemble.filter(row => row.id !== action.id),
        // Removed by hand, so the toggle has nothing left to take back.
        autoVocalId: draft.autoVocalId === action.id ? null : draft.autoVocalId,
      };
    }
    case 'replaceInstrument': {
      const entry = draft.ensemble.find(row => row.id === action.id);
      if (!entry || isNewProjectEntryLocked(draft, entry)) return draft;
      /*
        A row changed by hand is the reader's: it loses the tier the style gave
        it (so it cannot lock later, when generation is turned on) and stops
        being the singer the toggle would take back — taking back a violin the
        reader chose in the singer's place would remove their choice.
      */
      return {
        ...draft,
        ensemble: draft.ensemble.map(row =>
          row.id === action.id ? { id: row.id, value: action.value } : row
        ),
        autoVocalId: draft.autoVocalId === action.id ? null : draft.autoVocalId,
      };
    }
    case 'setBars':
      return {
        ...draft,
        measuresText: action.text,
        durationText: durationFor(
          draft,
          action.text,
          draft.tempoText,
          draft.meter
        ),
      };
    case 'setTempo':
      return {
        ...draft,
        tempoText: action.text,
        durationText: durationFor(
          draft,
          draft.measuresText,
          action.text,
          draft.meter
        ),
      };
    case 'setMeter':
      return {
        ...draft,
        meter: action.meter,
        durationText: durationFor(
          draft,
          draft.measuresText,
          draft.tempoText,
          action.meter
        ),
      };
    case 'setDuration': {
      /*
        Bars are the value; the duration is what is typed. So typing sets the
        bars when it parses and keeps the text either way — rewriting "1:" to
        "0:16" while somebody is still typing "1:30" is the form fighting them.
      */
      const seconds = parseDuration(action.text);
      return {
        ...draft,
        durationText: action.text,
        ...(seconds === null
          ? {}
          : {
              measuresText: String(
                barsForSeconds(
                  seconds,
                  draft.tempoText,
                  GENERATE_SCORE_TIME_SIGNATURE_OPTIONS[draft.meter]
                )
              ),
            }),
      };
    }
    case 'tidyDuration':
      return {
        ...draft,
        durationText: durationFor(
          draft,
          draft.measuresText,
          draft.tempoText,
          draft.meter
        ),
      };
  }
}

/*
  Choosing a style fills the form with the ordinary shape of that genre.

  Reggae is an electric guitar, an organ, a bass and a kit at 78bpm; picking the
  word and then being handed a lone piano at 120 is the generator asking the
  reader to already know the answer.

  It **overwrites**, deliberately: a preset that kept fields the reader had
  touched would leave a half-country, half-whatever-was-there ensemble nobody
  chose. Everything it sets stays editable. Clearing back to "no style" leaves
  the form alone — that is the reader saying they want no genre, not that they
  want the defaults back.

  The tempo is *drawn* inside the genre's range, and the bars recomputed from
  it, because the bar count is derived from the tempo: at a faster speed the
  same count is a shorter song. And the key is drawn from the keys the genre is
  played in and set into the field rather than sent invisibly, so it can be read
  and overridden — every score was in C before this, because the key field
  started at 0 and a style only ever set the mode.
*/
function applyStyle(
  draft: NewProjectFormDraft,
  style: string,
  rng: () => number
): NewProjectFormDraft {
  const preset = style ? GENERATE_SCORE_STYLE_PRESETS[style] : undefined;
  if (!preset) return { ...draft, style };

  const ensemble: NewProjectEntry[] = styleRoster(
    style,
    { voice: draft.generating },
    rng
  ).map((entry, id) => ({ id, value: entry.value, tier: entry.tier }));
  const pace = styleTempo(style, rng);
  const tempoText = String(pace?.tempo ?? preset.tempo);
  const measuresText = String(pace?.measures ?? preset.measures);
  const key = styleKey(style, rng);
  const next: NewProjectFormDraft = {
    ...draft,
    style,
    ensemble,
    nextEntryId: ensemble.length,
    // The singer the style added is the one turning generation off takes back.
    autoVocalId:
      ensemble.find(entry => hasVocalInstrument([entry.value]))?.id ?? null,
    tempoText,
    measuresText,
    meter: preset.timeSignature,
    keySignature: key ?? {
      ...draft.keySignature,
      ...(preset.mode ? { mode: preset.mode } : {}),
    },
  };
  return {
    ...next,
    durationText: durationFor(
      next,
      measuresText,
      tempoText,
      preset.timeSignature
    ),
  };
}

/*
  Turning the model on gives the roster somebody to sing, because a song needs
  one and the form otherwise opens on a piano solo — leaving the reader to know
  that a voice is filed under Ensemble before they can ask for a song. Turning
  it off takes back exactly what was given, by id: a voice the reader chose
  themselves is theirs. Never below one row, since a score with no tracks is
  not a score.
*/
function setGenerating(
  draft: NewProjectFormDraft,
  generating: boolean
): NewProjectFormDraft {
  if (generating) {
    if (hasVocalInstrument(draft.ensemble.map(entry => entry.value))) {
      return { ...draft, generating };
    }
    const id = draft.nextEntryId;
    return {
      ...draft,
      generating,
      ensemble: [
        { id, value: DEFAULT_VOCAL_INSTRUMENT_VALUE },
        ...draft.ensemble,
      ],
      nextEntryId: id + 1,
      autoVocalId: id,
    };
  }
  const id = draft.autoVocalId;
  if (id === null) return { ...draft, generating };
  return {
    ...draft,
    generating,
    autoVocalId: null,
    ensemble:
      draft.ensemble.length <= 1
        ? draft.ensemble
        : draft.ensemble.filter(entry => entry.id !== id),
  };
}

/**
 * Whether a row is one of the chosen style's essential instruments while a
 * model writes the music — a reggae with no kit is not reggae. Blank projects
 * lock nothing: nothing is being generated for the style to be true to.
 */
export function isNewProjectEntryLocked(
  draft: NewProjectFormDraft,
  entry: NewProjectEntry
): boolean {
  return draft.generating && draft.style !== '' && entry.tier === 'essential';
}

/**
 * Whether a row's Remove is offered. The floor is one row: a form that could
 * reach a roster it cannot submit from is worse than a disabled button.
 */
export function canRemoveNewProjectEntry(
  draft: NewProjectFormDraft,
  entry: NewProjectEntry
): boolean {
  return draft.ensemble.length > 1 && !isNewProjectEntryLocked(draft, entry);
}

/**
 * The locale key for what the project is called when nothing was typed.
 *
 * Two names, because the two modes produce different things and a reader can
 * tell them apart in a list. It is the placeholder *and* the fallback: a
 * placeholder showing a name you do not get is a label for a value that never
 * existed.
 */
export function newProjectDefaultTitleKey(draft: NewProjectFormDraft): string {
  return draft.generating
    ? 'newProject.defaultTitleGenerated'
    : 'newProject.defaultTitle';
}

/**
 * Whether the typed tempo is refused. Blank is fine — no tempo is sent — and
 * anything else that is not a positive number is what stops Create, so the
 * form says so rather than just greying the button out.
 */
export function newProjectTempoRefused(draft: NewProjectFormDraft): boolean {
  const text = draft.tempoText.trim();
  return text !== '' && !(Number(text) > 0);
}

/** Whether the Duration field holds something that is not a length. */
export function newProjectDurationRefused(draft: NewProjectFormDraft): boolean {
  return parseDuration(draft.durationText) === null;
}

function instrumentValues(draft: NewProjectFormDraft): string[] {
  return draft.ensemble.map(entry => entry.value);
}

/**
 * Whether the lyrics switch is offered: only where somebody can sing. The
 * request drops the field otherwise (`buildGenerateScoreRequest`), so this is
 * the form agreeing with the builder, not a second rule.
 */
export function showNewProjectLyrics(draft: NewProjectFormDraft): boolean {
  return hasVocalInstrument(instrumentValues(draft));
}

/** Whether the lyric-subject field is offered: over a singer, with words switched on. */
export function showNewProjectLyricsTheme(draft: NewProjectFormDraft): boolean {
  return showNewProjectLyrics(draft) && draft.lyrics;
}

/**
 * Whether the Duration field is shown.
 *
 * Not while a model is writing words: a song's length is its form, and the
 * lyric follows verses and choruses rather than a clock. A voice in a blank
 * project writes no words, so the clock stays there.
 */
export function showNewProjectDuration(draft: NewProjectFormDraft): boolean {
  return !(draft.generating && showNewProjectLyricsTheme(draft));
}

/**
 * The form as the shape music_lib's two builders read.
 *
 * One draft for both: `GenerateScoreRequestDraft` is assignable to
 * `NewProjectDraft`, so the Generate toggle decides only which builder runs.
 * The title goes as typed — `buildNewProjectScore` writes it into the score's
 * own metadata, where blank has always meant "Untitled".
 */
export function newProjectRequestDraft(
  draft: NewProjectFormDraft
): GenerateScoreRequestDraft {
  return {
    title: draft.title,
    prompt: draft.prompt,
    durationMeasures: Number(draft.measuresText),
    instrumentValues: instrumentValues(draft),
    complexity: draft.complexity,
    timeSignature: GENERATE_SCORE_TIME_SIGNATURE_OPTIONS[draft.meter],
    keySignature: draft.keySignature,
    style: draft.style,
    mood: draft.mood,
    tempoText: draft.tempoText,
    lyrics: draft.lyrics,
    lyricsTheme: draft.lyricsTheme,
  };
}

/**
 * The credits a generation from this form is quoted at: bars times
 * instruments, which is what the server bills. Zero while the bars are not a
 * usable count, which the form reads as "no quote".
 */
export function newProjectCreditEstimate(draft: NewProjectFormDraft): number {
  return estimateGenerateScoreCredits(
    Number(draft.measuresText),
    draft.ensemble.length
  );
}

/**
 * Whether Create is offered.
 *
 * One rule per mode, both from the builders, so the form cannot offer a Create
 * the builder then refuses. `outOfCredits` (see `isOutOfCredits`) gates
 * generation only — a blank project costs nothing, and refusing one would
 * refuse work the server never charges for.
 */
export function canCreateNewProject(
  draft: NewProjectFormDraft,
  state: { submitting: boolean; outOfCredits: boolean }
): boolean {
  if (state.submitting) return false;
  const request = newProjectRequestDraft(draft);
  return draft.generating
    ? !state.outOfCredits && canBuildGenerateScoreRequest(request)
    : canBuildNewProjectScore(request);
}

/**
 * What the form asked for, or `null` when the builder refuses it.
 *
 * `defaultTitle` is the caller's translation of `newProjectDefaultTitleKey`. It
 * names the *project*: for generation it rides on the request, and for a blank
 * project it is the submission's title while the score itself still says
 * "Untitled" — the score's title and the project's name are different things.
 * The variant is tagged on with `withGenerationVariant`, which leaves the
 * default backend off the wire.
 */
export function newProjectSubmission(
  draft: NewProjectFormDraft,
  defaultTitle: string
): NewProjectSubmission | null {
  const request = newProjectRequestDraft(draft);
  const title = draft.title.trim() || defaultTitle;
  if (draft.generating) {
    const built = buildGenerateScoreRequest({ ...request, title });
    return built
      ? {
          kind: 'generate',
          request: withGenerationVariant(built, draft.variant),
        }
      : null;
  }
  const score = buildNewProjectScore(request);
  return score ? { kind: 'blank', title, score } : null;
}
