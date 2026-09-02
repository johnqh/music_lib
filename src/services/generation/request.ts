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
  // The six this started with.
  'waltz',
  'jazz',
  'pop',
  'cinematic',
  'ambient',
  'battle',
  // Genres a listener can name in a bar of music. Ordered roughly by family —
  // rock and metal, then the American vernacular styles, then Latin and
  // Caribbean, then electronic, then the older written forms — because a list
  // of twenty-two in alphabetical order is a list nobody reads to the end of.
  'rock',
  'punk',
  'heavyMetal',
  'blues',
  'country',
  'bluegrass',
  'funk',
  'soul',
  'ragtime',
  'swing',
  'bossaNova',
  'samba',
  'salsa',
  'tango',
  'reggae',
  'hipHop',
  'lofi',
  'house',
  'electroSwing',
  'disco',
  'baroque',
  'march',
];

/**
 * What a style starts you with: who is playing, how fast, and for how long.
 *
 * Choosing "Reggae" and then being handed a lone piano at 120bpm is the
 * generator asking the reader to already know the answer. Each of these is the
 * ordinary shape of the genre — the instruments a listener would expect to
 * hear, the tempo it is played at, and a length that fits its form.
 *
 * Two of them are not round numbers and that is the point. **Blues is twelve
 * bars**, because the twelve-bar blues is the form rather than a length
 * someone chose; **ragtime is sixteen**, the usual strain. A style whose form
 * has a length says so here rather than leaving the reader to count.
 *
 * `instruments` are picker values, in ensemble order — `classifyTrackRole`
 * gives the melody to the first treble-clef track, so the order is a musical
 * decision and not a list. `kit:0` is the standard drum kit.
 *
 * Every program number is the General MIDI one from `GM_CATALOGUE`, checked
 * against it rather than remembered: the catalogue is the only place that
 * knows 105 is a banjo.
 *
 * A style is still only a hint. It fills the form so the reader can change it,
 * which is why nothing here is enforced anywhere — the token itself is what
 * reaches the model, and these fields are the reader's to overwrite.
 */
export type GenerateScoreStylePreset = {
  /**
   * What the model is told the style is.
   *
   * **Not the token.** The token is a camelCase identifier — `electroSwing`,
   * `heavyMetal` — and it went into the prompt verbatim as
   * `Style: electroSwing`, which is a variable name rather than an
   * instruction. The first six styles were single lowercase words, so nothing
   * noticed until the list grew.
   *
   * And it is a phrase rather than a name, because a genre's name is not its
   * definition. Asked for the name alone, the model returned sixteen bars of
   * unbroken straight eighth notes on all four instruments of an electro-swing
   * request — no syncopation, no phrasing, and no swing, which is half the
   * name. What makes a genre recognisable is its *rhythm*: the swung eighths,
   * the one-drop, the four-on-the-floor, the backbeat. So each one says so.
   */
  prompt: string;
  /** Picker values, in ensemble order. */
  instruments: readonly string[];
  /** Beats per minute, in the middle of the range the genre is played at. */
  tempo: number;
  /** Bars, where the genre's form implies a number. */
  measures: number;
  /** A key of `GENERATE_SCORE_TIME_SIGNATURE_OPTIONS`. */
  timeSignature: string;
  /** The mode the genre usually sits in; absent where it is not typical. */
  mode?: TimeSignatureMode;
};

/** Major or minor, as the key signature spells it. */
type TimeSignatureMode = 'major' | 'minor';

const KIT = 'kit:0';

export const GENERATE_SCORE_STYLE_PRESETS: Readonly<
  Record<string, GenerateScoreStylePreset>
> = {
  // --- the original six -----------------------------------------------------
  // A waltz is in three; that is what makes it a waltz.
  waltz: {
    prompt:
      'waltz — a lilting three-four with the weight on beat one and a light "oom-pah-pah" accompaniment',
    instruments: ['0', '48', '43'],
    tempo: 160,
    measures: 16,
    timeSignature: '3/4',
  },
  // A rhythm section plus a horn to carry the head.
  jazz: {
    prompt:
      'jazz — swung eighth notes, walking bass, extended chords, and a melody that phrases across the barline rather than sitting on the beat',
    instruments: ['66', '0', '32', KIT],
    tempo: 132,
    measures: 16,
    timeSignature: '4/4',
  },
  pop: {
    prompt:
      'pop — a clear singable hook, four-bar phrases, a backbeat on two and four, and space between the phrases',
    instruments: ['0', '27', '33', KIT],
    tempo: 120,
    measures: 16,
    timeSignature: '4/4',
  },
  cinematic: {
    prompt:
      'cinematic orchestral — long sustained lines that build, a rising dynamic arc, and rhythm that serves the swell rather than a groove',
    instruments: ['48', '40', '42', '60', '47'],
    tempo: 90,
    measures: 16,
    timeSignature: '4/4',
    mode: 'minor',
  },
  ambient: {
    prompt:
      'ambient — slow evolving pads, very long note values, no strong pulse, and silence used as a voice',
    instruments: ['89', '0', '48'],
    tempo: 70,
    measures: 16,
    timeSignature: '4/4',
  },
  battle: {
    prompt:
      'driving battle music — insistent ostinato, hard accents, brass stabs against a relentless low pulse',
    instruments: ['61', '48', '47', KIT],
    tempo: 150,
    measures: 16,
    timeSignature: '4/4',
    mode: 'minor',
  },

  // --- rock and metal -------------------------------------------------------
  rock: {
    prompt:
      'rock — a hard backbeat on two and four, power-chord riffing, and a bass locked to the kick',
    instruments: ['29', '27', '33', KIT],
    tempo: 128,
    measures: 16,
    timeSignature: '4/4',
  },
  // Fast, short, two guitars and no ornament.
  punk: {
    prompt:
      'punk — fast straight eighths on downstrokes, three chords, no ornament, and a snare driving every backbeat. The guitar figure repeats unchanged through a section; the energy comes from the tempo and the drive, never from varying the part.',
    // Overdriven rhythm under a distorted lead, not two of the same patch:
    // identical programs generate two tracks under one name, which is
    // unreadable in the track list and gives the model nothing to tell the
    // parts apart by. See the same fix in `country`.
    instruments: ['30', '29', '34', KIT],
    tempo: 180,
    measures: 16,
    timeSignature: '4/4',
  },
  heavyMetal: {
    prompt:
      'heavy metal — built on ONE palm-muted galloping low riff, repeated bar after bar through a section rather than rewritten each bar; minor and modal, double-kick drive underneath, and long held high notes over the top. The riff is the song: keep it the same and let the drums and the held lead supply the variation. ONE riff means one FIGURE, not one note - the riff moves between several pitches (root, flat-7, flat-6 and back is the classic shape), and a bar of the same pitch struck eight times is a pedal, not a riff.',
    // Twin guitars are the idiom here, but they are a rhythm part and a lead
    // part — the same program twice is one part written twice.
    instruments: ['30', '29', '34', KIT],
    tempo: 152,
    measures: 16,
    timeSignature: '4/4',
    mode: 'minor',
  },

  // --- American vernacular --------------------------------------------------
  // Twelve bars, because that is the form rather than a length.
  blues: {
    prompt:
      'twelve-bar blues — shuffle feel, blue notes and bends, call-and-response between a voice-like melody and answering fills, dominant seventh chords',
    instruments: ['27', '22', '33', KIT],
    tempo: 88,
    measures: 12,
    timeSignature: '4/4',
  },
  country: {
    prompt:
      'country — a two-beat "boom-chick" bass and guitar, bright major harmony, fiddle and steel fills answering the melody',
    /*
      Rhythm acoustic, fiddle, lead electric, bass, kit.

      The third slot was a second '25' — two tracks with the identical program
      generate under the identical name ("Acoustic Guitar (steel)" twice), which
      is unreadable in the track list and gives the model nothing to tell the
      two parts apart by. 27 is the clean Telecaster the genre actually uses for
      the lead against a strummed acoustic, and it is the one guitar voice the
      preset's own prompt ("fiddle and steel fills answering the melody") asks
      for and did not have.
    */
    instruments: ['25', '110', '27', '32', KIT],
    tempo: 118,
    measures: 16,
    timeSignature: '4/4',
  },
  // Banjo leads, fiddle answers, and nothing is amplified.
  bluegrass: {
    prompt:
      'bluegrass — fast acoustic picking, banjo rolls in constant eighths under a syncopated fiddle melody, driving upright bass on one and three',
    instruments: ['105', '110', '25', '32'],
    tempo: 160,
    measures: 16,
    timeSignature: '4/4',
  },
  funk: {
    prompt:
      'funk — heavily syncopated sixteenth-note groove, everything locked to a hard downbeat on the one, staccato stabs and plenty of rests',
    instruments: ['36', '28', '61', '4', KIT],
    tempo: 104,
    measures: 16,
    timeSignature: '4/4',
  },
  soul: {
    prompt:
      'soul — a laid-back backbeat sitting slightly behind the beat, gospel-tinged chords, horn stabs answering a vocal-style melody',
    instruments: ['16', '4', '33', '61', KIT],
    tempo: 96,
    measures: 16,
    timeSignature: '4/4',
  },
  // Piano alone, in two, as it was written for.
  ragtime: {
    prompt:
      'ragtime — a syncopated right-hand melody against a steady striding left-hand bass in two, cheerful and precise',
    instruments: ['0'],
    tempo: 96,
    measures: 16,
    timeSignature: '2/4',
  },
  // A big band: brass and reeds over a rhythm section.
  swing: {
    prompt:
      'big-band swing — swung eighth notes, brass and reed sections trading riffs, walking bass, ride-cymbal pulse with accents on two and four',
    instruments: ['56', '66', '57', '0', '32', KIT],
    tempo: 168,
    measures: 32,
    timeSignature: '4/4',
  },

  // --- Latin and Caribbean --------------------------------------------------
  bossaNova: {
    prompt:
      'bossa nova — a gentle syncopated guitar pattern, soft brushed drums, a lyrical melody sitting behind the beat, rich seventh and ninth chords',
    instruments: ['24', '0', '32', KIT],
    tempo: 132,
    measures: 16,
    timeSignature: '4/4',
  },
  samba: {
    prompt:
      'samba — fast two-beat percussion-driven groove, heavy syncopation on the offbeats, surdo pulse landing on beat two',
    instruments: ['24', '61', '32', KIT],
    tempo: 100,
    measures: 16,
    timeSignature: '2/4',
  },
  salsa: {
    prompt:
      'salsa — clave-driven, a montuno piano ostinato, syncopated brass hits, busy percussion, bass playing the tumbao rather than the downbeat',
    instruments: ['0', '56', '57', '32', KIT],
    tempo: 190,
    measures: 16,
    timeSignature: '4/4',
  },
  // The bandoneon is not in General MIDI; its tango accordion is.
  tango: {
    prompt:
      'tango — sharp dotted rhythms and dramatic accents, minor key, sudden stops and rubato pulls against a strict pulse',
    instruments: ['23', '40', '0', '43'],
    tempo: 120,
    measures: 16,
    timeSignature: '4/4',
    mode: 'minor',
  },
  // One drop: the weight is off the downbeat, and it is slower than it feels.
  reggae: {
    prompt:
      'reggae — one-drop: the kick lands on beat three, not one; guitar and organ chop the offbeat eighths; bass plays a heavy melodic line, low and sparse',
    instruments: ['28', '18', '33', KIT],
    tempo: 78,
    measures: 16,
    timeSignature: '4/4',
  },

  // --- electronic and modern ------------------------------------------------
  hipHop: {
    prompt:
      'hip-hop — a hard boom-bap drum pattern with swung sixteenths, a deep sustained sub bass, sparse looping keys, and space left for a vocal',
    instruments: ['39', '4', '48', KIT],
    tempo: 90,
    measures: 16,
    timeSignature: '4/4',
    mode: 'minor',
  },
  lofi: {
    prompt:
      'lo-fi hip-hop — slow swung drums slightly off the grid, warm jazzy minor seventh chords, a sparse melody, unhurried and repetitive',
    instruments: ['4', '33', '89', KIT],
    tempo: 74,
    measures: 16,
    timeSignature: '4/4',
    /*
      Minor, like the hip hop it comes from.

      A genre is a tonality as much as a tempo — the same gap that made electro
      swing come back as cheerful major swing nobody would name as the style.
      Lo-fi lives on minor sevenths, and `hipHop` beside it was already minor.
    */
    mode: 'minor',
  },
  house: {
    prompt:
      'house — four-on-the-floor kick, offbeat open hats, a repetitive synth riff, and a bassline locked to the eighths between the kicks',
    instruments: ['81', '38', '89', KIT],
    tempo: 126,
    measures: 16,
    timeSignature: '4/4',
  },
  // Swing horns over a four-on-the-floor: the joke only works with both.
  /*
    Minor, and it has to be said.

    Electro swing is a minor-mode genre — the gypsy-jazz side of it is where
    the sound comes from, and Caravan Palace and Parov Stelar live in D and A
    minor. With no `mode` the builder defaults to major, and a generated piece
    came back as cheerful C-major swing that nobody would name as this style.
    A tempo and a lineup do not make a genre if the tonality is wrong.

    The clarinet is in the roster for the same reason: it is the gypsy-jazz
    voice the style is built on, and the prompt was already asking for one.
  */
  electroSwing: {
    prompt:
      'electro swing — vintage swing horns over a modern four-on-the-floor electronic beat, minor and bluesy in a gypsy-jazz vein; hard-swung eighths, syncopated and playful, with clarinet and trumpet riffs answering each other',
    instruments: ['56', '71', '38', KIT],
    tempo: 122,
    measures: 16,
    timeSignature: '4/4',
    mode: 'minor',
  },
  disco: {
    prompt:
      'disco — four-on-the-floor kick, offbeat hi-hats, an octave-jumping bassline, and string and guitar figures on the sixteenths',
    instruments: ['48', '28', '33', KIT],
    tempo: 120,
    measures: 16,
    timeSignature: '4/4',
  },

  // --- written forms --------------------------------------------------------
  baroque: {
    prompt:
      'baroque — a steady walking bass, contrapuntal interweaving voices, sequences and ornamented melodic lines, terraced dynamics',
    instruments: ['6', '40', '42'],
    tempo: 100,
    measures: 16,
    timeSignature: '4/4',
  },
  march: {
    prompt:
      'march — a firm two-beat pulse, dotted fanfare rhythms, a brass melody over a low oom-pah, crisp snare figures',
    instruments: ['56', '57', '58', KIT],
    tempo: 116,
    measures: 16,
    timeSignature: '2/4',
  },
};

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
 * lineup, without a second table saying so for each of the twenty-eight
 * styles.
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
/**
 * A request tagged with the generation backend to use, when it is not the default.
 *
 * One line of decision, but it lives here rather than in a call site because
 * both apps make the same call and a rule copied into two of them is a rule
 * that eventually disagrees with itself — the same reason the style presets and
 * the bar/beat readout ended up here.
 *
 * The default is expressed by sending **no field at all**, so an ordinary
 * generation is byte-for-byte what it was before backends could be chosen.
 * That matters on the wire: a field present on every request is a field the
 * server has to reason about on every request.
 */
export function withGenerationVariant(
  request: GenerateScoreRequest,
  variant: string | undefined
): GenerateScoreRequest {
  return variant && variant !== 'default' ? { ...request, variant } : request;
}

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
