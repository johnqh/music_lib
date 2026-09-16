import { describe, expect, it } from 'vitest';
import {
  gmInstrument,
  gmKitAt,
  styleTempoRange,
} from '@sudobility/music_types';
import { createEmptyScore } from '@sudobility/music_types';
import { DEFAULT_VOCAL_INSTRUMENT_VALUE } from '@sudobility/music_types';
import {
  hasVocalInstrument,
  STYLE_OPTIONAL_PICKS,
  styleRoster,
  styleKey,
  styleTempo,
  buildGenerateScoreRequest,
  buildGenerateTrackRequest,
  canBuildGenerateScoreRequest,
  estimateGenerateScoreCredits,
  estimateGenerateTrackCredits,
  estimateReplacementCredits,
  firstMelodyInstrumentEntryId,
  generateScoreTrackForInstrumentValue,
  buildNewProjectScore,
  canBuildNewProjectScore,
} from './request.js';
import { GENERATE_SCORE_TIME_SIGNATURE_OPTIONS } from '@sudobility/music_types';
import type { GenerateScoreRequestDraft } from '@sudobility/music_types';
import {
  GENERATE_SCORE_STYLE_OPTIONS,
  GENERATE_SCORE_STYLE_PRESETS,
} from '@sudobility/music_types';

const BASE_DRAFT = {
  prompt: 'A calm piano melody',
  durationMeasures: 8,
  instrumentValues: ['0'],
  complexity: 'moderate' as const,
  timeSignature: { numerator: 4, denominator: 4 },
  keySignature: { fifths: 0, mode: 'major' as const },
};

describe('generate score request helpers', () => {
  it('maps an instrument catalogue value to a request track', () => {
    expect(generateScoreTrackForInstrumentValue('0')).toEqual({
      name: 'Acoustic Grand Piano',
      instrumentName: 'Acoustic Grand Piano',
      midiProgram: 0,
      clef: 'treble',
    });
  });

  it('builds a request from form state', () => {
    expect(
      buildGenerateScoreRequest({
        ...BASE_DRAFT,
        title: '  Nocturne  ',
        // The picker's value goes in…
        style: 'ambient',
        mood: 'calm',
        tempoText: ' 84 ',
      })
    ).toEqual({
      prompt: 'A calm piano melody',
      title: 'Nocturne',
      durationMeasures: 8,
      tracks: [
        {
          name: 'Acoustic Grand Piano',
          instrumentName: 'Acoustic Grand Piano',
          midiProgram: 0,
          clef: 'treble',
        },
      ],
      complexity: 'moderate',
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: { fifths: 0, mode: 'major' },
      /*
        …and the *phrase* comes out. The server interpolates this straight into
        its prompt, and `Style: ambient` left the model guessing at the rhythm
        — see `GenerateScoreStylePreset.prompt`.
      */
      style: GENERATE_SCORE_STYLE_PRESETS.ambient!.prompt,
      mood: 'calm',
      tempo: 84,
    });
  });

  it('refuses drafts that would violate the shared request schema', () => {
    expect(canBuildGenerateScoreRequest({ ...BASE_DRAFT, prompt: '   ' })).toBe(
      false
    );
    expect(
      canBuildGenerateScoreRequest({ ...BASE_DRAFT, durationMeasures: 1.5 })
    ).toBe(false);
    expect(
      canBuildGenerateScoreRequest({ ...BASE_DRAFT, instrumentValues: [] })
    ).toBe(false);
    expect(
      canBuildGenerateScoreRequest({ ...BASE_DRAFT, tempoText: '0' })
    ).toBe(false);
  });

  it('refuses what only the shared schema can catch', () => {
    // The four cases above are all caught by the hand-written guard, so they
    // pass whether or not the schema is consulted. These reach the schema and
    // nothing else: each one satisfies every explicit check and is still not a
    // request the server would accept.
    expect(
      buildGenerateScoreRequest({
        ...BASE_DRAFT,
        timeSignature: { numerator: 4, denominator: 0 },
      })
    ).toBeNull();
    expect(
      buildGenerateScoreRequest({
        ...BASE_DRAFT,
        keySignature: { fifths: 1.5, mode: 'major' },
      })
    ).toBeNull();
    // An instrument value the catalogue does not know yields a track the
    // schema rejects, rather than a request that fails at the server.
    expect(
      buildGenerateScoreRequest({
        ...BASE_DRAFT,
        instrumentValues: ['not-an-instrument'],
      })
    ).toBeNull();
  });

  it('estimates credits from valid bars times tracks', () => {
    expect(estimateGenerateScoreCredits(4, 3)).toBe(12);
    expect(estimateGenerateScoreCredits(-4, 3)).toBe(0);
    expect(estimateGenerateScoreCredits(1.5, 3)).toBe(0);
  });

  it('identifies the first non-percussion entry as the melody track', () => {
    expect(
      firstMelodyInstrumentEntryId([
        { id: 1, value: 'kit:0' },
        { id: 2, value: '32' },
      ])
    ).toBe(2);
    expect(
      firstMelodyInstrumentEntryId([{ id: 1, value: 'kit:0' }])
    ).toBeUndefined();
  });
});

describe('buildGenerateTrackRequest', () => {
  it('matches the open score, or the track will not line up with it', () => {
    /*
      The whole reason this takes a Score. A track generated at a different
      length, time signature, key or tempo is unusable rather than merely
      different — it does not fit the music it was asked to accompany.
    */
    const score = createEmptyScore({ title: 'Waltz', measures: 12 });
    const request = buildGenerateTrackRequest(score, 'a bass line', {
      midiProgram: 33,
      instrumentName: 'Electric Bass',
      clef: 'bass',
    });
    expect(request.durationMeasures).toBe(12);
    expect(request.timeSignature).toEqual(
      score.tracks[0].measures[0].timeSignature
    );
    expect(request.keySignature).toEqual(
      score.tracks[0].measures[0].keySignature
    );
    expect(request.tempo).toBe(score.tempoMap[0].bpm);
  });

  it('takes the clef from the choice, not from the program', () => {
    // A drum kit is not a GM program — kit 40 is Brush where program 40 is
    // Violin — so the percussion clef is the only thing that tells them apart.
    const score = createEmptyScore({ title: 'Beat', measures: 4 });
    const request = buildGenerateTrackRequest(score, 'a groove', {
      midiProgram: 40,
      instrumentName: 'Brush Kit',
      clef: 'percussion',
    });
    expect(request.tracks[0].clef).toBe('percussion');
    expect(request.tracks[0].midiProgram).toBe(40);
  });

  it('asks for exactly one track', () => {
    // The server appends what it produces; asking for two would append two.
    const score = createEmptyScore({ title: 'Waltz', measures: 4 });
    const request = buildGenerateTrackRequest(score, 'a line', {
      midiProgram: 0,
      instrumentName: 'Piano',
      clef: 'treble',
    });
    expect(request.tracks).toHaveLength(1);
  });
});

describe('style presets', () => {
  /*
    Choosing "Reggae" and being handed a lone piano at 120bpm is the generator
    asking the reader to already know the answer. Each style fills the form
    with the ordinary shape of its genre; these pin that the data is real
    rather than that the taste is right.
  */
  it('gives every offered style a preset', () => {
    // A style in the menu with no preset silently fills nothing, which reads
    // as the control being broken rather than as that genre having no default.
    for (const style of GENERATE_SCORE_STYLE_OPTIONS) {
      expect(GENERATE_SCORE_STYLE_PRESETS[style]).toBeDefined();
    }
  });

  it('offers every preset it defines', () => {
    // The other direction: a preset nobody can choose is dead data.
    for (const style of Object.keys(GENERATE_SCORE_STYLE_PRESETS)) {
      expect(GENERATE_SCORE_STYLE_OPTIONS).toContain(style);
    }
  });

  it('names instruments General MIDI actually has', () => {
    /*
      Program numbers are the one thing here that can be silently wrong: 105 is
      a banjo and 110 is a fiddle, and a transposed digit produces a plausible
      ensemble made of the wrong instruments. Checked against the catalogue,
      which is the only thing that knows.
    */
    for (const [style, preset] of Object.entries(
      GENERATE_SCORE_STYLE_PRESETS
    )) {
      for (const value of preset.instruments) {
        if (value.startsWith('kit:')) {
          expect(gmKitAt(Number(value.slice(4)))).toBeDefined();
          continue;
        }
        const program = Number(value);
        expect(Number.isInteger(program)).toBe(true);
        expect(gmInstrument(program), `${style} -> ${value}`).toBeDefined();
      }
    }
  });

  it('uses a time signature the picker offers', () => {
    // The dialog sets its picker from this string; one the picker has no entry
    // for would leave the control blank.
    for (const preset of Object.values(GENERATE_SCORE_STYLE_PRESETS)) {
      expect(
        GENERATE_SCORE_TIME_SIGNATURE_OPTIONS[preset.timeSignature]
      ).toBeDefined();
    }
  });

  it('asks for a playable tempo and at least one bar', () => {
    for (const [style, preset] of Object.entries(
      GENERATE_SCORE_STYLE_PRESETS
    )) {
      expect(preset.tempo, style).toBeGreaterThanOrEqual(40);
      expect(preset.tempo, style).toBeLessThanOrEqual(240);
      expect(preset.measures, style).toBeGreaterThan(0);
      expect(preset.instruments.length, style).toBeGreaterThan(0);
    }
  });

  it('keeps the forms that have a length', () => {
    /*
      Twelve-bar blues and the sixteen-bar rag are the form, not a choice.

      This used to assert 12 bars outright, when every preset declared its own
      length and a blues was one chorus — about thirty seconds. Lengths are
      derived from a target duration now, so what has to hold is that a blues
      is a whole number of TWELVES: rounded to fours like everything else, a
      three-minute blues came out at 76 bars, six choruses and a third of one.
    */
    const blues = GENERATE_SCORE_STYLE_PRESETS.blues;
    expect(blues?.formBars).toBe(12);
    expect((blues?.measures ?? 0) % 12).toBe(0);
    expect(blues?.measures).toBeGreaterThan(12);
    const rag = GENERATE_SCORE_STYLE_PRESETS.ragtime;
    expect(rag?.formBars).toBe(16);
    expect((rag?.measures ?? 0) % 16).toBe(0);
    expect(GENERATE_SCORE_STYLE_PRESETS.ragtime?.timeSignature).toBe('2/4');
    // And a waltz is in three, which is what makes it one.
    expect(GENERATE_SCORE_STYLE_PRESETS.waltz?.timeSignature).toBe('3/4');
  });
});

describe('the style that reaches the model', () => {
  /*
    The bug this pins, found by reading a generated score rather than the code.

    An electro-swing request produced sixteen bars of unbroken straight eighth
    notes on all four instruments — 116 of 122 notes on the trumpet, 126 of 127
    on the sax and bass — with onsets only on the beat and the half-beat. No
    syncopation, no phrasing, and no swing, which is half the genre's name.

    What the model had been told was `Style: electroSwing`: a camelCase
    identifier. The first six styles were single lowercase words, so the token
    doubling as the instruction went unnoticed until the list grew.
  */
  it('sends a phrase, never the camelCase token', () => {
    const request = buildGenerateScoreRequest({
      prompt: 'anything',
      durationMeasures: 8,
      instrumentValues: ['0'],
      style: 'electroSwing',
      tempoText: '',
    });
    expect(request?.style).not.toBe('electroSwing');
    expect(request?.style).toContain('electro swing');
  });

  it('tells the model what the genre sounds like, not just its name', () => {
    // A name is not a definition. Swing is defined by swung eighths; reggae by
    // where the kick lands. If the phrase does not say so, the model guesses.
    const request = buildGenerateScoreRequest({
      prompt: 'anything',
      durationMeasures: 8,
      instrumentValues: ['0'],
      style: 'reggae',
      tempoText: '',
    });
    expect(request?.style).toMatch(/one-drop|beat three/i);
  });

  it('describes the rhythm of every style it offers', () => {
    /*
      Rhythm is what makes a genre recognisable, and it is the thing the model
      got wrong when left to infer it. Each phrase names its own — a beat, a
      subdivision, a feel — rather than only naming instruments or a mood.
      Length is a crude proxy for that, but a one-word prompt is the failure
      mode this is guarding, and a one-word prompt is short.
    */
    for (const [style, preset] of Object.entries(
      GENERATE_SCORE_STYLE_PRESETS
    )) {
      expect(preset.prompt.length, style).toBeGreaterThan(40);
      expect(preset.prompt, style).not.toBe(style);
      // Lower-case prose, not an identifier.
      expect(preset.prompt, style).not.toMatch(/^[a-z]+[A-Z]/);
    }
  });

  it('still sends an unknown style as itself', () => {
    // A style with no preset travels as what the caller asked for rather than
    // vanishing — the model can do something with a word it was given.
    const request = buildGenerateScoreRequest({
      prompt: 'anything',
      durationMeasures: 8,
      instrumentValues: ['0'],
      style: 'klezmer',
      tempoText: '',
    });
    expect(request?.style).toBe('klezmer');
  });
});

/*
 * A style's roster is its essential instruments, its preferred ones, and a
 * couple of optional ones drawn at random. The essential tier is what the
 * dialogs refuse to remove: a reggae without its kit is not reggae.
 */
describe('styleRoster', () => {
  const values = (entries: readonly { value: string }[]) =>
    entries.map(e => e.value);

  it('always carries every essential and preferred instrument', () => {
    for (const style of Object.keys(GENERATE_SCORE_STYLE_PRESETS)) {
      const preset = GENERATE_SCORE_STYLE_PRESETS[style];
      const roster = styleRoster(style, { voice: true }, () => 0.3);
      for (const value of [...preset.essential, ...preset.preferred]) {
        expect(values(roster), `${style} ${value}`).toContain(value);
      }
      for (const value of preset.essential) {
        expect(roster.find(e => e.value === value)?.tier).toBe('essential');
      }
    }
  });

  it(`draws ${STYLE_OPTIONAL_PICKS} optional instruments, different ones as the roll changes`, () => {
    const preset = GENERATE_SCORE_STYLE_PRESETS.reggae;
    const drawn = new Set<string>();
    for (const roll of [0, 0.3, 0.6, 0.99]) {
      const optional = styleRoster(
        'reggae',
        { voice: true },
        () => roll
      ).filter(e => e.tier === 'optional');
      expect(optional).toHaveLength(STYLE_OPTIONAL_PICKS);
      expect(new Set(values(optional)).size).toBe(STYLE_OPTIONAL_PICKS);
      for (const e of optional) {
        expect(preset.optional).toContain(e.value);
        drawn.add(e.value);
      }
    }
    expect(drawn.size).toBeGreaterThan(STYLE_OPTIONAL_PICKS);
  });

  it('draws fewer when the pool is smaller', () => {
    expect(
      styleRoster('punk', { voice: true }, () => 0).filter(
        e => e.tier === 'optional'
      )
    ).toHaveLength(1);
  });

  it('adds no singer unless the model is writing the music', () => {
    for (const style of Object.keys(GENERATE_SCORE_STYLE_PRESETS)) {
      for (const roll of [0, 0.5, 0.99]) {
        expect(
          styleRoster(style, { voice: false }, () => roll).some(e =>
            hasVocalInstrument([e.value])
          )
        ).toBe(false);
      }
    }
    expect(values(styleRoster('pop', { voice: true }, () => 0))[0]).toBe('53');
  });

  it('puts the singer first and the kit last', () => {
    const roster = values(styleRoster('reggae', { voice: true }, () => 0));
    expect(roster[0]).toBe('53');
    expect(roster[roster.length - 1]).toBe('kit:0');
  });

  /* Violin (40) and Fiddle (110) are one instrument under two GM names. */
  it('never draws a rename of something already there', () => {
    for (let roll = 0; roll < 1; roll += 0.05) {
      const roster = values(
        styleRoster('country', { voice: true }, () => roll)
      );
      expect(roster).toContain('110');
      expect(roster).not.toContain('40');
    }
  });

  it('stays in range at the top of the roll', () => {
    expect(
      styleRoster('rock', { voice: true }, () => 1).every(
        e => e.value !== undefined
      )
    ).toBe(true);
  });

  it('has nothing to say about a style it does not know', () => {
    expect(styleRoster('not-a-style', { voice: true })).toEqual([]);
  });
});

/**
 * What every preset has to get right, checked across all of them at once.
 *
 * These are properties a reader would have to verify by eye across twenty-eight
 * entries, which is how the same defect reached three of them.
 */
describe('every style preset', () => {
  const entries = Object.entries(GENERATE_SCORE_STYLE_PRESETS);

  /*
   * Two tracks with the same program generate under the same instrument name —
   * unreadable in the track list, and the model has nothing to tell the parts
   * apart by, so it writes one part twice. Found in `country` (two steel
   * guitars) and then in `punk` and `heavyMetal` (two distortion guitars);
   * twin guitars are the idiom in metal, but as a rhythm part and a lead part,
   * which is two different programs.
   */
  it('names each instrument at most once', () => {
    for (const [style, preset] of entries) {
      const seen = new Set<string>();
      for (const value of preset.instruments) {
        expect(
          seen.has(value),
          `${style} lists instrument ${value} twice`
        ).toBe(false);
        seen.add(value);
      }
    }
  });

  /* A lineup with nothing in it cannot be generated from. */
  it('has at least one instrument', () => {
    for (const [style, preset] of entries) {
      expect(preset.instruments.length, style).toBeGreaterThan(0);
    }
  });

  /* A tempo or length outside these is a typo, not a style. */
  it('states a plausible tempo, and a length a listener would call a song', () => {
    /*
      Asserted as DURATION, not bars.

      Every preset used to declare 16 bars, which is about thirty seconds — and
      a bar count cannot be checked across styles anyway, since 16 bars is 31
      seconds of metal at 152bpm and 46 of a ballad at 84. What matters is the
      time it takes, so that is what is bounded.
    */
    for (const [style, preset] of entries) {
      expect(preset.tempo, style).toBeGreaterThanOrEqual(40);
      expect(preset.tempo, style).toBeLessThanOrEqual(240);
      const beats = Number(preset.timeSignature.split('/')[0]);
      const seconds = (preset.measures * beats * 60) / preset.tempo;
      expect(seconds, `${style} runs ${Math.round(seconds)}s`).toBeGreaterThan(
        150
      );
      expect(seconds, `${style} runs ${Math.round(seconds)}s`).toBeLessThan(
        360
      );
    }
  });

  it('states a time signature the picker offers', () => {
    for (const [style, preset] of entries) {
      // The options are a record keyed by the "4/4" string, not a list.
      expect(
        GENERATE_SCORE_TIME_SIGNATURE_OPTIONS[preset.timeSignature],
        `${style} uses ${preset.timeSignature}`
      ).toBeDefined();
    }
  });

  /*
   * The style token has to reach the model as a PHRASE. A prompt that is just
   * the token back again tells it nothing it did not already have.
   */
  it('describes the style rather than naming it', () => {
    for (const [style, preset] of entries) {
      expect(preset.prompt.length, style).toBeGreaterThan(30);
      expect(preset.prompt.toLowerCase(), style).not.toBe(style.toLowerCase());
    }
  });
});

describe('buildNewProjectScore', () => {
  const base = {
    durationMeasures: 8,
    instrumentValues: ['40', '42'],
  };

  it('builds the ensemble that was chosen, with its programs', () => {
    // Through `generateScoreTrackForInstrumentValue`, which is what carries
    // midiProgram — a String Quartet that came back as four pianos is the
    // failure this exists to prevent.
    const score = buildNewProjectScore(base);
    expect(score?.tracks.map(t => t.midiProgram)).toEqual([40, 42]);
    // Both treble, and that is `clefForProgram`'s rule rather than an
    // oversight: only the GM *Bass family* (32-39) reads better on the bass
    // staff, so a cello at program 42 opens on treble and is changed on the
    // track afterwards.
    expect(score?.tracks.map(t => t.clef)).toEqual(['treble', 'treble']);
  });

  it('builds the number of bars asked for, on every track', () => {
    const score = buildNewProjectScore({ ...base, durationMeasures: 12 });
    expect(score?.tracks.map(t => t.measures.length)).toEqual([12, 12]);
  });

  it('needs no prompt — that is the whole difference from a generation', () => {
    expect(canBuildNewProjectScore(base)).toBe(true);
    expect(canBuildGenerateScoreRequest({ ...base, prompt: '' })).toBe(false);
  });

  it('titles the score, falling back to Untitled', () => {
    expect(
      buildNewProjectScore({ ...base, title: '  Wedding March  ' })?.metadata
        .title
    ).toBe('Wedding March');
    expect(buildNewProjectScore(base)?.metadata.title).toBe('Untitled');
  });

  it('carries the meter and key into every measure', () => {
    const score = buildNewProjectScore({
      ...base,
      timeSignature: { numerator: 3, denominator: 4 },
      keySignature: { fifths: -3, mode: 'minor' },
    });
    const first = score?.tracks[0]?.measures[0];
    expect(first?.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(first?.keySignature).toEqual({ fifths: -3, mode: 'minor' });
  });

  it('takes a blank tempo as "no tempo", and a bad one as a refusal', () => {
    // The same rule the generating builder applies, so the two modes cannot
    // disagree about what a form is allowed to submit.
    expect(
      buildNewProjectScore({ ...base, tempoText: '' })?.tempoMap[0]?.bpm
    ).toBe(120);
    expect(
      buildNewProjectScore({ ...base, tempoText: '90' })?.tempoMap[0]?.bpm
    ).toBe(90);
    expect(buildNewProjectScore({ ...base, tempoText: 'fast' })).toBeNull();
    expect(buildNewProjectScore({ ...base, tempoText: '0' })).toBeNull();
  });

  it('refuses a form it could not make a score from', () => {
    expect(buildNewProjectScore({ ...base, durationMeasures: 0 })).toBeNull();
    expect(buildNewProjectScore({ ...base, durationMeasures: 2.5 })).toBeNull();
    expect(buildNewProjectScore({ ...base, instrumentValues: [] })).toBeNull();
  });

  it('accepts a generation draft unchanged, because one form feeds both', () => {
    // `GenerateScoreRequestDraft` is assignable to `NewProjectDraft`. If this
    // stops compiling, the two have been allowed to drift and the toggle can
    // no longer be a toggle.
    const draft: GenerateScoreRequestDraft = {
      ...base,
      prompt: 'A waltz',
      style: 'waltz',
    };
    expect(buildNewProjectScore(draft)).not.toBeNull();
  });
});

describe('a sung roster', () => {
  const draft = (instrumentValues: readonly string[], lyrics?: boolean) => ({
    prompt: 'a song about the sea',
    durationMeasures: 16,
    instrumentValues,
    ...(lyrics === undefined ? {} : { lyrics }),
  });

  it('knows when a roster has somebody singing in it', () => {
    expect(
      hasVocalInstrument(['0', '33', DEFAULT_VOCAL_INSTRUMENT_VALUE])
    ).toBe(true);
    expect(hasVocalInstrument(['0', '33', 'kit:0'])).toBe(false);
    expect(hasVocalInstrument([])).toBe(false);
  });

  it('asks for words only when the draft says so', () => {
    expect(
      buildGenerateScoreRequest(draft([DEFAULT_VOCAL_INSTRUMENT_VALUE], true))
        ?.lyrics
    ).toBe(true);
  });

  it('omits the field entirely when no words were asked for', () => {
    const request = buildGenerateScoreRequest(
      draft([DEFAULT_VOCAL_INSTRUMENT_VALUE])
    );
    expect(request).not.toBeNull();
    expect(request && 'lyrics' in request).toBe(false);
  });

  it('never asks for words over a roster with nobody to sing them', () => {
    const request = buildGenerateScoreRequest(draft(['0', 'kit:0'], true));
    expect(request && 'lyrics' in request).toBe(false);
  });
});

describe("the lyric's subject", () => {
  const draft = (over: Record<string, unknown> = {}) => ({
    prompt: 'a slow waltz in D minor',
    durationMeasures: 16,
    instrumentValues: [DEFAULT_VOCAL_INSTRUMENT_VALUE],
    lyrics: true,
    ...over,
  });

  it('travels when the words are about something of their own', () => {
    expect(
      buildGenerateScoreRequest(
        draft({ lyricsTheme: 'a love song about coming home' })
      )?.lyricsTheme
    ).toBe('a love song about coming home');
  });

  it('is left off when there is none, so the words follow the piece', () => {
    const request = buildGenerateScoreRequest(draft());
    expect(request && 'lyricsTheme' in request).toBe(false);
  });

  it('is left off when it is only whitespace', () => {
    // An input somebody tabbed through is not a subject.
    const request = buildGenerateScoreRequest(draft({ lyricsTheme: '   ' }));
    expect(request && 'lyricsTheme' in request).toBe(false);
  });

  it('never travels without the lyrics it describes', () => {
    /*
      A theme for a lyric nobody asked for is the disagreement this field was
      once left out to avoid. Gated in the builder rather than trusted at each
      call site, exactly as `lyrics` itself is.
    */
    const off = buildGenerateScoreRequest(
      draft({ lyrics: false, lyricsTheme: 'a love song' })
    );
    expect(off && 'lyricsTheme' in off).toBe(false);
  });

  it('never travels over a roster with nobody to sing it', () => {
    const instrumental = buildGenerateScoreRequest(
      draft({ instrumentValues: ['0', 'kit:0'], lyricsTheme: 'a love song' })
    );
    expect(instrumental && 'lyricsTheme' in instrumental).toBe(false);
    expect(instrumental && 'lyrics' in instrumental).toBe(false);
  });
});

/*
 * Every score this app generated was in C — measured across every stored
 * project, `fifths` was 0 without exception. The dialog initialised the key to
 * 0 and a style only ever overwrote the mode, so two genres arrived in one key
 * and sounded like each other whatever their rhythms did.
 */
describe('styleKey', () => {
  it('picks a key the style is actually played in', () => {
    // Big-band keys are flat: B♭, E♭, F, C.
    expect(styleKey('swing', () => 0)).toEqual({ fifths: -2, mode: 'major' });
    // Guitar music lives where the open strings are.
    expect(styleKey('rock', () => 0)).toEqual({ fifths: 4, mode: 'major' });
  });

  it("reads the tonic in the style's own mode", () => {
    // Electro swing is a minor genre, so 0 is A minor rather than C major.
    expect(styleKey('electroSwing', () => 0)).toEqual({
      fifths: -1,
      mode: 'minor',
    });
  });

  it('does not answer the same key every time', () => {
    const seen = new Set(
      Array.from({ length: 4 }, (_, i) => styleKey('jazz', () => i / 4)?.fifths)
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('leaves a style it does not know alone', () => {
    expect(styleKey('sea shanty')).toBeNull();
  });

  it('offers a key for every style the app can choose', () => {
    for (const style of GENERATE_SCORE_STYLE_OPTIONS) {
      expect(
        styleKey(style, () => 0),
        style
      ).not.toBeNull();
    }
  });
});

describe('styleTempo', () => {
  it("picks a tempo inside the genre's own range", () => {
    for (const style of GENERATE_SCORE_STYLE_OPTIONS) {
      const [min, max] = styleTempoRange(style)!;
      for (const r of [0, 0.5, 0.999]) {
        const picked = styleTempo(style, () => r)!;
        expect(picked.tempo, `${style} @ ${r}`).toBeGreaterThanOrEqual(min);
        expect(picked.tempo, `${style} @ ${r}`).toBeLessThanOrEqual(max);
      }
    }
  });

  /*
   * The bar count is derived from the tempo — `measures` is "bars that fill
   * three and a half minutes at this speed" — so a faster piece needs more of
   * them to last as long. Returning one without the other is how a generation
   * ends up half a minute short.
   */
  it('gives more bars to a faster tempo', () => {
    const slow = styleTempo('pop', () => 0)!;
    const fast = styleTempo('pop', () => 0.999)!;
    expect(fast.tempo).toBeGreaterThan(slow.tempo);
    expect(fast.measures).toBeGreaterThanOrEqual(slow.measures);
  });

  it('keeps a blues in whole twelve-bar choruses at any tempo', () => {
    for (const r of [0, 0.3, 0.6, 0.999]) {
      expect(styleTempo('blues', () => r)!.measures % 12).toBe(0);
    }
  });

  it('does not answer the same tempo every time', () => {
    const seen = new Set(
      Array.from(
        { length: 8 },
        (_, i) => styleTempo('salsa', () => i / 8)?.tempo
      )
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('leaves a style it does not know alone', () => {
    expect(styleTempo('sea shanty')).toBeNull();
  });
});

/*
 * Every generate modal quotes what the server bills: bars times tracks, and a
 * Replace is charged the whole bars its region touches.
 */
describe('credit estimates for the editor modals', () => {
  const score = buildNewProjectScore({
    title: 'x',
    durationMeasures: 4,
    instrumentValues: ['0', '40'],
    timeSignature: { numerator: 4, denominator: 4 },
  })!;
  const [piano, violin] = score.tracks;
  const bar = piano.measures[0].durationTicks;

  it('charges a Replace Notes the bars it touches, per track', () => {
    const region = {
      range: {
        startTick: bar / 2,
        endTick: bar + bar / 2,
        trackIds: [piano.id, violin.id],
      },
      measureAligned: false,
      noteCount: 0,
      unselectedNoteCount: 0,
    };
    expect(estimateReplacementCredits(score, region)).toBe(4);
  });

  it('charges a new track every bar of the score once', () => {
    expect(estimateGenerateTrackCredits(score)).toBe(4);
  });
});
