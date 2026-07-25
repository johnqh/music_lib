import { describe, expect, it } from 'vitest';
import { extractFragment, replaceFragment } from '../../domain/score/fragment.js';
import { validateScore } from '../../domain/validation/validator.js';
import { measureDurationTicks } from '../../domain/time/ticks.js';
import type { GenerateScoreRequest, RegenerateRegionRequest } from '@sudobility/music_types';
import { MockGenerationProvider } from './mock-provider.js';

function baseRequest(overrides: Partial<GenerateScoreRequest> = {}): GenerateScoreRequest {
  return {
    prompt: 'Create a gentle eight-measure piano melody in C major',
    durationMeasures: 8,
    tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
    ...overrides,
  };
}

function multiTrackRequest(): GenerateScoreRequest {
  return {
    prompt: 'Create an upbeat pop arrangement with piano, bass, drums',
    durationMeasures: 4,
    tracks: [
      { name: 'Melody', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' },
      { name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' },
      { name: 'Bass', instrumentName: 'Acoustic Bass', midiProgram: 32, clef: 'bass' },
      { name: 'Drums', instrumentName: 'Drum Kit', midiProgram: 0, clef: 'percussion' },
    ],
  };
}

describe('MockGenerationProvider.generateScore', () => {
  it('produces a score with exactly durationMeasures measures per track, each of exact measure length, with zero validation errors', async () => {
    const provider = new MockGenerationProvider({ seed: 'test-seed' });
    const { score, warnings } = await provider.generateScore(baseRequest());

    expect(warnings).toEqual([]);
    for (const track of score.tracks) {
      expect(track.measures).toHaveLength(8);
      for (const measure of track.measures) {
        const covered = measure.voices.flatMap((v) => v.events).reduce((sum, e) => sum + e.durationTicks, 0);
        expect(covered).toBe(measure.durationTicks);
      }
    }
    const issues = validateScore(score);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('is deterministic: same seed + same request -> deep-equal scores', async () => {
    const request = baseRequest();
    const a = await new MockGenerationProvider({ seed: 42 }).generateScore(request);
    const b = await new MockGenerationProvider({ seed: 42 }).generateScore(request);
    expect(a).toEqual(b);
  });

  it('different seeds produce different scores for the same request', async () => {
    const request = baseRequest();
    const a = await new MockGenerationProvider({ seed: 1 }).generateScore(request);
    const b = await new MockGenerationProvider({ seed: 2 }).generateScore(request);
    expect(a).not.toEqual(b);
  });

  it('repeated calls on the same provider instance are also deterministic', async () => {
    const provider = new MockGenerationProvider({ seed: 'stable' });
    const request = baseRequest();
    const a = await provider.generateScore(request);
    const b = await provider.generateScore(request);
    expect(a).toEqual(b);
  });

  it('honors an explicit keySignature/timeSignature/tempo over prompt hints', async () => {
    const provider = new MockGenerationProvider({ seed: 1 });
    const { score } = await provider.generateScore(
      baseRequest({
        prompt: 'Create a piece in D minor', // would hint D minor if not overridden
        keySignature: { fifths: 2, mode: 'major' },
        timeSignature: { numerator: 3, denominator: 4 },
        tempo: 140,
      }),
    );
    expect(score.tempoMap[0].bpm).toBe(140);
    expect(score.tracks[0].measures[0].timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(score.tracks[0].measures[0].keySignature).toEqual({ fifths: 2, mode: 'major' });
  });

  it('picks up key/meter hints from the prompt when not explicitly set', async () => {
    const provider = new MockGenerationProvider({ seed: 1 });
    const { score } = await provider.generateScore(baseRequest({ prompt: 'Create a playful waltz in 3/4 time' }));
    expect(score.tracks[0].measures[0].timeSignature).toEqual({ numerator: 3, denominator: 4 });
  });

  it('assembles a multi-track arrangement (melody, harmony, bass, drums) all valid and correctly sized', async () => {
    const provider = new MockGenerationProvider({ seed: 'multi' });
    const { score } = await provider.generateScore(multiTrackRequest());

    expect(score.tracks).toHaveLength(4);
    for (const track of score.tracks) {
      expect(track.measures).toHaveLength(4);
    }
    // Drum track uses MIDI channel 9 (channel 10, 0-indexed) per convention.
    const drumTrack = score.tracks.find((t) => t.clef === 'percussion')!;
    expect(drumTrack.midiChannel).toBe(9);

    expect(validateScore(score).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('defaults to a single Piano track when tracks is empty', async () => {
    const provider = new MockGenerationProvider({ seed: 1 });
    const { score } = await provider.generateScore(baseRequest({ tracks: [] }));
    expect(score.tracks).toHaveLength(1);
    expect(score.tracks[0].name).toBe('Piano');
  });

  it('respects a per-track pitch range constraint', async () => {
    const provider = new MockGenerationProvider({ seed: 'range-test' });
    const { score } = await provider.generateScore(
      baseRequest({
        tracks: [
          {
            name: 'Piano',
            instrumentName: 'Piano',
            midiProgram: 0,
            clef: 'treble',
            range: { lowestMidi: 60, highestMidi: 72 },
          },
        ],
      }),
    );
    for (const measure of score.tracks[0].measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if ('pitch' in event) {
            const midi =
              60 +
              (event.pitch.octave - 4) * 12 +
              ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const)[event.pitch.step] +
              event.pitch.accidental;
            expect(midi).toBeGreaterThanOrEqual(60);
            expect(midi).toBeLessThanOrEqual(72);
          }
        }
      }
    }
  });

  it('rejects when the AbortSignal is already aborted', async () => {
    const provider = new MockGenerationProvider({ seed: 1 });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.generateScore(baseRequest(), controller.signal)).rejects.toThrow();
  });

  it('rejects an invalid request (schema violation)', async () => {
    const provider = new MockGenerationProvider({ seed: 1 });
    const invalid = { ...baseRequest(), durationMeasures: -1 };
    await expect(provider.generateScore(invalid)).rejects.toThrow();
  });
});

describe('MockGenerationProvider.regenerateRegion', () => {
  async function buildScoreAndRegion(seed: number | string = 'region') {
    const provider = new MockGenerationProvider({ seed });
    const { score } = await provider.generateScore(baseRequest({ durationMeasures: 8 }));
    const track = score.tracks[0];
    const measureTicks = measureDurationTicks(track.measures[0].timeSignature, score.ppq);
    const range = { startTick: measureTicks * 2, endTick: measureTicks * 4, trackIds: [track.id] };
    const request: RegenerateRegionRequest = {
      scoreId: score.id,
      instruction: 'Make this more dramatic',
      range,
      precedingContext: extractFragment(score, { startTick: measureTicks, endTick: measureTicks * 2, trackIds: [track.id] }),
      selectedFragment: extractFragment(score, range),
      followingContext: extractFragment(score, { startTick: measureTicks * 4, endTick: measureTicks * 5, trackIds: [track.id] }),
      constraints: { preserveMeasureCount: true, preserveTimeSignatures: true, preserveTempoEvents: true },
      candidateCount: 3,
    };
    return { provider, score, request };
  }

  it('returns candidateCount candidates, each valid when merged into the score with exact measure lengths preserved', async () => {
    const { score, request } = await buildScoreAndRegion();
    const provider = new MockGenerationProvider({ seed: 'region' });
    const { candidates, warnings } = await provider.regenerateRegion(request);

    expect(candidates).toHaveLength(3);
    expect(warnings).toEqual([]);

    for (const candidate of candidates) {
      const merged = replaceFragment(score, candidate.fragment);
      expect(validateScore(merged).filter((i) => i.severity === 'error')).toEqual([]);

      const originalTrackMeasureCount = score.tracks[0].measures.length;
      const mergedTrack = merged.tracks.find((t) => t.id === score.tracks[0].id)!;
      expect(mergedTrack.measures).toHaveLength(originalTrackMeasureCount); // preserveMeasureCount
      // Exact measure lengths (accounting for simultaneous/chord notes, e.g. from the "dramatic"
      // transform's octave doublings) are already asserted by validateScore's zero-errors check above.
    }
  });

  it('preserves time signatures across the regenerated region', async () => {
    const { score, request } = await buildScoreAndRegion();
    const provider = new MockGenerationProvider({ seed: 'region' });
    const { candidates } = await provider.regenerateRegion(request);

    for (const candidate of candidates) {
      const merged = replaceFragment(score, candidate.fragment);
      const mergedTrack = merged.tracks.find((t) => t.id === score.tracks[0].id)!;
      for (let i = 0; i < mergedTrack.measures.length; i += 1) {
        expect(mergedTrack.measures[i].timeSignature).toEqual(score.tracks[0].measures[i].timeSignature);
      }
    }
  });

  it('is deterministic per (request, seed, candidate index)', async () => {
    const { request } = await buildScoreAndRegion('same-region-seed');
    const a = await new MockGenerationProvider({ seed: 'same-region-seed' }).regenerateRegion(request);
    const b = await new MockGenerationProvider({ seed: 'same-region-seed' }).regenerateRegion(request);
    expect(a).toEqual(b);
  });

  it('different candidates within one call are distinct from each other', async () => {
    const { request } = await buildScoreAndRegion();
    const provider = new MockGenerationProvider({ seed: 'region' });
    const { candidates } = await provider.regenerateRegion(request);
    expect(candidates[0].fragment).not.toEqual(candidates[1].fragment);
    expect(candidates[1].fragment).not.toEqual(candidates[2].fragment);
  });

  it('rejects when the AbortSignal is already aborted', async () => {
    const { request } = await buildScoreAndRegion();
    const provider = new MockGenerationProvider({ seed: 'region' });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.regenerateRegion(request, controller.signal)).rejects.toThrow();
  });
});
