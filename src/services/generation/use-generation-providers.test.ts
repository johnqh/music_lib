import { describe, expect, it } from 'vitest';
import {
  GENERATION_VARIANTS,
  GENERATION_VARIANT_LABELS,
} from '@sudobility/music_types';
import type {
  GenerationProviderPrefs,
  GenerationProviderStoreHook,
} from './use-generation-providers';
import { useGenerationProviders } from './use-generation-providers';

describe('useGenerationProviders', () => {
  it('returns the shared provider catalog and the preference-backed selection', () => {
    let state: GenerationProviderPrefs = {
      generationVariant: 'claude',
      setGenerationVariant: variant => {
        state.generationVariant = variant;
      },
    };
    const usePrefs = Object.assign(
      <Value>(selector: (prefs: GenerationProviderPrefs) => Value) =>
        selector(state),
      { getState: () => state }
    ) as GenerationProviderStoreHook<GenerationProviderPrefs>;

    const providers = useGenerationProviders(usePrefs);
    expect(providers.providers).toEqual(
      GENERATION_VARIANTS.map(value => ({
        value,
        label: GENERATION_VARIANT_LABELS[value],
      }))
    );
    expect(providers.selected).toBe('claude');

    providers.setSelected('deepseek');
    expect(state.generationVariant).toBe('deepseek');
  });
});
