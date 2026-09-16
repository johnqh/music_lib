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
import type { UiSlice } from '@sudobility/music_editing';
import type { PrefsStorage, ToastSink } from '@sudobility/music_types';
import {
  createId,
  parseGenerateScoreResult,
  parseRegenerateRegionResult,
} from '@sudobility/music_types';
import { libraryMessage } from '../services/messages.js';

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
  /**
   * Where toasts go, when the host does not render them from the store.
   *
   * Absent, a toast is appended to `state.toasts` and the host's toast list
   * reads it from there — the web app. Present, every `pushToast` and
   * `dismissToast` on a store built from this context goes here instead and
   * nothing is held in state: the native app has no list reading the store,
   * and a toast held where nobody dismisses it is one that accumulates forever.
   */
  toasts?: ToastSink;
};

/**
 * `pushToast`/`dismissToast`, pointed at a sink.
 *
 * Spread over the editing slices when a context carries one, so every toast in
 * the store — an editing refusal, a failed autosave, a playback error, a failed
 * generation job — takes the one route, rather than each raiser having to know
 * which host it is in.
 */
export function toastSinkActions(
  sink: ToastSink
): Pick<UiSlice, 'pushToast' | 'dismissToast'> {
  return {
    pushToast: toast => {
      const id = createId();
      sink.push({
        id,
        message: toast.message,
        severity: toast.severity ?? 'info',
        ...(toast.action ? { action: toast.action } : {}),
      });
      return id;
    },
    dismissToast: id => sink.dismiss(id),
  };
}

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
