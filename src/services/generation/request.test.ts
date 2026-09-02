import { describe, expect, it } from 'vitest';
import { gmInstrument, gmKitAt } from '@sudobility/music_types';
import { createEmptyScore } from '@sudobility/music_types';
import {
  GENERATE_SCORE_STYLE_OPTIONS,
  GENERATE_SCORE_STYLE_PRESETS,
  GUEST_INSTRUMENTS,
  styleInstrumentsWithGuest,
  withGenerationVariant,
  GENERATE_SCORE_TIME_SIGNATURE_OPTIONS,
  buildGenerateScoreRequest,
  buildGenerateTrackRequest,
  canBuildGenerateScoreRequest,
  estimateGenerateScoreCredits,
  firstMelodyInstrumentEntryId,
  generateScoreTrackForInstrumentValue,
} from './request.js';

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
    // Twelve-bar blues and the sixteen-bar rag are the form, not a choice.
    expect(GENERATE_SCORE_STYLE_PRESETS.blues?.measures).toBe(12);
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

/**
 * The guest instrument.
 *
 * Every generation of one style otherwise draws the same four or five
 * instruments, so sixteen bars of country came back as sixteen bars of country
 * every time. One instrument from outside the style's own roster is what makes
 * each attempt its own piece.
 */
describe('styleInstrumentsWithGuest', () => {
  const first = () => 0;
  const last = () => 0.999999;

  it('adds exactly one instrument to the style’s own roster', () => {
    const preset = GENERATE_SCORE_STYLE_PRESETS.country;
    const withGuest = styleInstrumentsWithGuest('country', first);
    expect(withGuest).toHaveLength(preset.instruments.length + 1);
    expect(withGuest.slice(0, -1)).toEqual([...preset.instruments]);
  });

  /*
   * "Not in the typical instruments for the style" is exactly the preset's own
   * roster, which is why no per-style exclusion table is needed: a banjo is
   * never offered to bluegrass because bluegrass already has one.
   */
  it('never offers an instrument the style already has', () => {
    for (const style of Object.keys(GENERATE_SCORE_STYLE_PRESETS)) {
      const preset = GENERATE_SCORE_STYLE_PRESETS[style];
      for (const pick of [first, last, () => 0.5]) {
        const withGuest = styleInstrumentsWithGuest(style, pick);
        const guest = withGuest[withGuest.length - 1];
        if (withGuest.length > preset.instruments.length) {
          expect(preset.instruments).not.toContain(guest);
        }
      }
    }
  });

  it('picks from the guest pool, and a different one as the roll changes', () => {
    const picks = new Set(
      [0, 0.2, 0.4, 0.6, 0.8, 0.99].map(r => {
        const list = styleInstrumentsWithGuest('house', () => r);
        return list[list.length - 1];
      })
    );
    expect(picks.size).toBeGreaterThan(1);
    for (const pick of picks) expect(GUEST_INSTRUMENTS).toContain(pick);
  });

  /* A second drummer is not a guest. */
  it('never offers a drum kit', () => {
    expect(GUEST_INSTRUMENTS.some(v => v.startsWith('kit:'))).toBe(false);
  });

  it('stays in range at the top of the roll', () => {
    // Math.random() is [0,1), but a caller-supplied rng may not be; the index
    // must never run off the end of the pool.
    const list = styleInstrumentsWithGuest('rock', () => 1);
    expect(list.length).toBe(
      GENERATE_SCORE_STYLE_PRESETS.rock.instruments.length + 1
    );
    expect(list[list.length - 1]).toBeDefined();
  });

  it('has nothing to say about a style it does not know', () => {
    expect(styleInstrumentsWithGuest('not-a-style', first)).toEqual([]);
  });
});

/*
 * Violin (40) and Fiddle (110) are one instrument under two GM names, so a
 * lineup with a fiddle must never be offered a violin as its guest — it would
 * be handed the part it already had, which is the duplicate-instrument bug in
 * a form that excluding by program alone cannot see.
 */
describe('the guest is never a rename of something already there', () => {
  it('offers no violin to a lineup that has a fiddle', () => {
    for (const style of ['country', 'bluegrass']) {
      expect(GENERATE_SCORE_STYLE_PRESETS[style].instruments).toContain('110');
      for (let roll = 0; roll < 1; roll += 0.02) {
        const list = styleInstrumentsWithGuest(style, () => roll);
        expect(list[list.length - 1]).not.toBe('40');
      }
    }
  });

  it('still offers a violin where nothing plays one', () => {
    const seen = new Set<string>();
    for (let roll = 0; roll < 1; roll += 0.02) {
      const list = styleInstrumentsWithGuest('house', () => roll);
      seen.add(list[list.length - 1]);
    }
    expect(seen).toContain('40');
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
  it('states a plausible tempo and length', () => {
    for (const [style, preset] of entries) {
      expect(preset.tempo, style).toBeGreaterThanOrEqual(40);
      expect(preset.tempo, style).toBeLessThanOrEqual(240);
      expect(preset.measures, style).toBeGreaterThanOrEqual(4);
      expect(preset.measures, style).toBeLessThanOrEqual(64);
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

/**
 * The generation backend rides on the request, and only when it is not the
 * default — so an ordinary generation is exactly what it was before backends
 * could be chosen.
 */
describe('withGenerationVariant', () => {
  const base = { prompt: 'p', durationMeasures: 8, tracks: [] } as never;

  it('sends no field for the default', () => {
    expect(withGenerationVariant(base, 'default')).not.toHaveProperty(
      'variant'
    );
    expect(withGenerationVariant(base, undefined)).not.toHaveProperty(
      'variant'
    );
    expect(withGenerationVariant(base, '')).not.toHaveProperty('variant');
  });

  it('tags the request with any other backend', () => {
    expect(withGenerationVariant(base, 'deepseek').variant).toBe('deepseek');
    expect(withGenerationVariant(base, 'weak').variant).toBe('weak');
  });

  it('leaves the rest of the request alone', () => {
    const tagged = withGenerationVariant(base, 'deepseek');
    expect(tagged.prompt).toBe('p');
    expect(tagged.durationMeasures).toBe(8);
    // A new object, so a caller's request is never mutated under it.
    expect(tagged).not.toBe(base);
  });
});
