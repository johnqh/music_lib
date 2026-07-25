/**
 * Generation-provider registry (spec §11, §33): a single module-level
 * `MusicGenerationProvider` instance that the store's `generation-slice`
 * (and anything else that needs to generate/regenerate) calls through
 * `getProvider()`, rather than each call site constructing its own
 * `MockGenerationProvider`. This is what makes the developer-settings
 * "mock seed" (spec §33) actually take effect: changing it (via
 * `setMockSeed`) swaps the module-level provider for a freshly seeded one,
 * so the *next* generate/regenerate call picks it up automatically.
 *
 * `setProvider` exists so tests (and, later, a real AI backend swapped in
 * behind the same `MusicGenerationProvider` interface) can substitute a
 * different provider without reaching into this module's internals.
 *
 * `DEFAULT_MOCK_SEED` is exported so `ui-slice.ts`'s `DEFAULT_DEV_SETTINGS.
 * seed` can import the exact same constant, rather than each module
 * hardcoding its own copy of `'scoresmith-mock'` that could silently drift
 * apart. Without that, the registry's default provider and the developer
 * settings' displayed default seed disagree until a user (or test) happens
 * to trigger `setDevSettings({ seed })` — i.e. the app boots with output
 * that *looks* seeded/deterministic in the devSettings UI but isn't
 * actually seeded in the registry until something writes to it.
 */
import { MockGenerationProvider } from './mock-provider.js';
import type { MusicGenerationProvider } from '@sudobility/music_types';

/** The seed every fresh app boot (and every `resetProvider()`) starts with, absent an explicit `setMockSeed`/`setDevSettings({ seed })` call. Shared with `ui-slice.ts`'s `DEFAULT_DEV_SETTINGS.seed` so the two can never drift apart. */
export const DEFAULT_MOCK_SEED = 'scoresmith-mock';

let currentProvider: MusicGenerationProvider = new MockGenerationProvider({
  seed: DEFAULT_MOCK_SEED,
});

/** The active generation provider. Defaults to a `MockGenerationProvider` seeded with `DEFAULT_MOCK_SEED` until `setProvider`/`setMockSeed` replaces it. */
export function getProvider(): MusicGenerationProvider {
  return currentProvider;
}

/** Replaces the active provider outright (e.g. with a test double, or eventually a real AI-backed provider). */
export function setProvider(provider: MusicGenerationProvider): void {
  currentProvider = provider;
}

/** Replaces the active provider with a fresh `MockGenerationProvider` seeded from developer settings (spec §33). */
export function setMockSeed(seed: number | string): void {
  currentProvider = new MockGenerationProvider({ seed });
}

/** Resets the registry to a fresh `MockGenerationProvider` seeded with `DEFAULT_MOCK_SEED` (test teardown convenience). */
export function resetProvider(): void {
  currentProvider = new MockGenerationProvider({ seed: DEFAULT_MOCK_SEED });
}
