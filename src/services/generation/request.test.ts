import { describe, expect, it } from 'vitest';
import {
  buildGenerateScoreRequest,
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
      style: 'ambient',
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
