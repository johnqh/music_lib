import { afterEach, describe, expect, it } from 'vitest';
import { MockGenerationProvider } from './mock-provider';
import {
  DEFAULT_MOCK_SEED,
  getProvider,
  resetProvider,
  setMockSeed,
  setProvider,
} from './registry';
import type { GenerateScoreRequest } from '@sudobility/music_types';

afterEach(() => {
  resetProvider();
});

const REQUEST: GenerateScoreRequest = {
  prompt: 'test',
  durationMeasures: 2,
  tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
};

describe('getProvider', () => {
  it('defaults to a MockGenerationProvider', () => {
    expect(getProvider()).toBeInstanceOf(MockGenerationProvider);
    expect(getProvider().id).toBe('mock');
  });

  it('defaults to a provider seeded with DEFAULT_MOCK_SEED, not an unseeded one (finding 1)', async () => {
    // Two fresh "boots" of the registry (no setMockSeed/setDevSettings call
    // in between) must produce deep-equal output, and that output must
    // match a MockGenerationProvider explicitly constructed with
    // DEFAULT_MOCK_SEED -- proving the default provider really is seeded,
    // not just coincidentally deterministic.
    const first = await getProvider().generateScore(REQUEST);
    resetProvider();
    const second = await getProvider().generateScore(REQUEST);
    const reference = await new MockGenerationProvider({ seed: DEFAULT_MOCK_SEED }).generateScore(
      REQUEST,
    );

    expect(first.score).toEqual(reference.score);
    expect(second.score).toEqual(reference.score);
  });
});

describe('setMockSeed', () => {
  it('swaps in a freshly seeded MockGenerationProvider that produces deterministic output for that seed', async () => {
    setMockSeed('registry-test-seed');
    const first = await getProvider().generateScore(REQUEST);

    setMockSeed('registry-test-seed');
    const second = await getProvider().generateScore(REQUEST);

    expect(second.score).toEqual(first.score);
  });

  it('changing the seed changes subsequent output', async () => {
    setMockSeed('seed-a');
    const a = await getProvider().generateScore(REQUEST);

    setMockSeed('seed-b');
    const b = await getProvider().generateScore(REQUEST);

    expect(b.score).not.toEqual(a.score);
  });
});

describe('setProvider', () => {
  it('replaces the active provider outright', () => {
    const fake: MockGenerationProvider = new MockGenerationProvider({ seed: 'fake' });
    setProvider(fake);
    expect(getProvider()).toBe(fake);
  });
});
