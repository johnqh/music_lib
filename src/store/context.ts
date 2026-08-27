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
  /**
   * The gateway to music_api — **absent when there is no server**.
   *
   * Optional because a native app edits a local file with nobody signed in,
   * and a store it cannot construct is a store it cannot edit in. Everything
   * that does not need a server keeps working without one; see `hasServer`.
   */
  client?: MusicClient;
  /**
   * Returns the current user's ID token, or null when signed out.
   *
   * Optional alongside `client`, and treated as one capability with it: a
   * client with no way to authenticate cannot make any call this store makes.
   */
  getToken?: () => Promise<string | null>;
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

/**
 * Thrown when a server-backed feature is reached on a host that has no server.
 *
 * Deliberately not `AuthRequiredError`. Signing in fixes that one; nothing
 * fixes this one, because the host never had a server to begin with. A UI that
 * cannot tell them apart offers a sign-in button that leads nowhere.
 */
export class ServerUnavailableError extends Error {
  constructor() {
    super(libraryMessage('serverUnavailable'));
    this.name = 'ServerUnavailableError';
  }
}

/** A context that can actually reach music_api. */
export type ServerContext = StoreContext & {
  client: MusicClient;
  getToken: () => Promise<string | null>;
};

/**
 * Whether this context can reach music_api at all.
 *
 * The one question a host should ask before *offering* a server-backed
 * feature. Both halves are required together: a client with no token getter
 * cannot make any call this store makes, so half a server is no server.
 */
export function hasServer(context: StoreContext): context is ServerContext {
  return context.client !== undefined && context.getToken !== undefined;
}

/** Narrows to a `ServerContext` or throws. The backstop behind `hasServer`. */
export function requireServer(context: StoreContext): ServerContext {
  if (!hasServer(context)) throw new ServerUnavailableError();
  return context;
}

export async function requireToken(context: StoreContext): Promise<string> {
  const token = await requireServer(context).getToken();
  if (!token) throw new AuthRequiredError();
  return token;
}

/**
 * The client and a live token together, which is what every server call here
 * actually needs.
 *
 * One call rather than `requireServer` followed by `requireToken`, because
 * those two are never wanted apart and pairing them at each call site is how
 * one of them comes to be forgotten.
 */
export async function authorizedServer(
  context: StoreContext
): Promise<{ client: MusicClient; token: string }> {
  const server = requireServer(context);
  return { client: server.client, token: await requireToken(server) };
}

/**
 * MusicGenerationProvider implementation backed by music_api via
 * MusicClient. Responses are already validated server-side; they are still
 * schema-parsed here as a client-boundary guarantee (spec §37.8) so a
 * misbehaving proxy can never inject malformed structures into the store.
 */
export class ApiGenerationProvider implements MusicGenerationProvider {
  readonly id = 'music-api-openai';
  readonly name = 'Moosiac AI';
  private readonly context: StoreContext;

  constructor(context: StoreContext) {
    this.context = context;
  }

  async generateScore(
    request: GenerateScoreRequest,
    signal?: AbortSignal
  ): Promise<GenerateScoreResult> {
    const { client, token } = await authorizedServer(this.context);
    const result = await client.generateScore(request, token, signal);
    return parseGenerateScoreResult(result);
  }

  async regenerateRegion(
    request: RegenerateRegionRequest,
    signal?: AbortSignal
  ): Promise<RegenerateRegionResult> {
    const { client, token } = await authorizedServer(this.context);
    const result = await client.regenerateRegion(request, token, signal);
    return parseRegenerateRegionResult(result);
  }
}
