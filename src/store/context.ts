/**
 * StoreContext — the injected backend context every store instance closes
 * over (Phase 2 of the re-architecture): the MusicClient gateway to
 * music_api, an auth-token getter (Firebase ID token; null when signed
 * out), and a device-prefs storage (structurally @sudobility/di's
 * StorageService — declared structurally here so music_lib needs no di
 * import and tests can pass a plain in-memory object).
 */
import type { MusicClient } from '@sudobility/music_client';
import type {
  GenerateScoreRequest,
  GenerateScoreResult,
  MusicGenerationProvider,
  RegenerateRegionRequest,
  RegenerateRegionResult,
} from '@sudobility/music_types';
import {
  parseGenerateScoreResult,
  parseRegenerateRegionResult,
} from '@sudobility/music_types';
import { libraryMessage } from '../services/messages.js';

/** Structural subset of @sudobility/di's StorageService used for device prefs. */
export type PrefsStorage = {
  getItem(
    key: string
  ): Promise<string | null | undefined> | string | null | undefined;
  setItem(key: string, value: string): Promise<void> | void;
};

export type StoreContext = {
  client: MusicClient;
  /** Returns the current user's ID token, or null when signed out. */
  getToken: () => Promise<string | null>;
  /** Device-prefs storage; omitted in tests that don't touch prefs. */
  storage?: PrefsStorage;
  /** Test override: replaces the default ApiGenerationProvider. */
  provider?: MusicGenerationProvider;
};

/** Thrown when an authenticated call is attempted while signed out. */
export class AuthRequiredError extends Error {
  constructor() {
    super(libraryMessage('authRequired'));
    this.name = 'AuthRequiredError';
  }
}

export async function requireToken(context: StoreContext): Promise<string> {
  const token = await context.getToken();
  if (!token) throw new AuthRequiredError();
  return token;
}

/**
 * MusicGenerationProvider implementation backed by music_api via
 * MusicClient. Responses are already validated server-side; they are still
 * schema-parsed here as a client-boundary guarantee (spec §37.8) so a
 * misbehaving proxy can never inject malformed structures into the store.
 */
export class ApiGenerationProvider implements MusicGenerationProvider {
  readonly id = 'music-api-openai';
  readonly name = 'ScoreSmith AI';
  private readonly context: StoreContext;

  constructor(context: StoreContext) {
    this.context = context;
  }

  async generateScore(
    request: GenerateScoreRequest,
    signal?: AbortSignal
  ): Promise<GenerateScoreResult> {
    const token = await requireToken(this.context);
    const result = await this.context.client.generateScore(
      request,
      token,
      signal
    );
    return parseGenerateScoreResult(result);
  }

  async regenerateRegion(
    request: RegenerateRegionRequest,
    signal?: AbortSignal
  ): Promise<RegenerateRegionResult> {
    const token = await requireToken(this.context);
    const result = await this.context.client.regenerateRegion(
      request,
      token,
      signal
    );
    return parseRegenerateRegionResult(result);
  }
}
