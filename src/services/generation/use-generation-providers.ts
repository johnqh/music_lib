import {
  GENERATION_VARIANTS,
  GENERATION_VARIANT_LABELS,
} from '@sudobility/music_types';

export type GenerationProviderOption = {
  value: (typeof GENERATION_VARIANTS)[number];
  label: string;
};

export type GenerationProviderPrefs = {
  generationVariant: string;
  setGenerationVariant: (variant: string) => void;
};

/** The small part of a bound store hook this shared hook needs. */
export type GenerationProviderStoreHook<T extends GenerationProviderPrefs> = {
  <Value>(selector: (state: T) => Value): Value;
  getState: () => T;
};

const PROVIDERS: ReadonlyArray<GenerationProviderOption> =
  GENERATION_VARIANTS.map(value => ({
    value,
    label: GENERATION_VARIANT_LABELS[value],
  }));

/** One provider list and the preference-backed selection for every generator. */
export function useGenerationProviders<T extends GenerationProviderPrefs>(
  usePrefs: GenerationProviderStoreHook<T>
) {
  const selected = usePrefs(state => state.generationVariant);
  return {
    providers: PROVIDERS,
    selected,
    setSelected: (variant: string) =>
      usePrefs.getState().setGenerationVariant(variant),
  };
}
