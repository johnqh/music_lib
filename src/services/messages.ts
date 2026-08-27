/**
 * The user-facing text this library needs, supplied by the host application.
 *
 * Nothing in here is written in English — or in any language. Most strings a
 * consumer needs are passed at the call that produces them (a command's label,
 * an importer's warnings), but a few are raised from inside long-lived
 * internals — an autosave that fails minutes after the call that started it,
 * a playback engine that cannot start — where there is no call site left to
 * carry them. Those come from this catalogue, which the host sets once at
 * bootstrap.
 *
 * Same reasoning as `setErrorLogging`: the library does not know its host, and
 * the host is the only thing that knows what language it is speaking.
 *
 * **Every entry is a function, resolved at the moment the message is needed.**
 * They used to be plain strings, captured when the host called
 * `setLibraryMessages` — which strands whatever language was loaded at
 * start-up, so a reader who switches to Chinese goes on getting English
 * toasts. `EditingCopy` already learned this and passes `commandLabel` as a
 * resolver for the same reason. The shape stays an object with a field per
 * message rather than a single `(key) => string`, because a record fails to
 * compile when a member is added and a resolver silently goes on answering for
 * the old set.
 */

export type LibraryMessages = {
  /** Action label on a retryable error toast. */
  retry: () => string;
  /** Autosave to the server failed; the change is still held locally. */
  saveFailed: () => string;
  /** The transport could not start. */
  playbackFailed: () => string;
  /** The score could not be handed to the playback engine. */
  scoreLoadFailed: () => string;
  /** An authenticated call was attempted while signed out. */
  authRequired: () => string;
  /**
   * A server-backed feature was reached on a host that has no server.
   *
   * Distinct from `authRequired`, which means "sign in and this works". This
   * one means the feature is not on offer here at all — a native app editing a
   * local file. A host whose UI asks `serverAvailable` first should never show
   * it; it is the backstop for the paths that do not.
   */
  serverUnavailable: () => string;
};

export type LibraryMessageKey = keyof LibraryMessages;

/**
 * Empty until the host says otherwise.
 *
 * Empty rather than English: a missing message then shows as nothing at all,
 * which is visible in review, where a plausible English default would ship
 * silently in a Chinese build and look like a translation someone forgot.
 */
const EMPTY = () => '';

let messages: LibraryMessages = {
  retry: EMPTY,
  saveFailed: EMPTY,
  playbackFailed: EMPTY,
  scoreLoadFailed: EMPTY,
  authRequired: EMPTY,
  serverUnavailable: EMPTY,
};

/** Called once at bootstrap by the host application. */
export function setLibraryMessages(next: LibraryMessages): void {
  messages = next;
}

export function libraryMessage(key: LibraryMessageKey): string {
  return messages[key]();
}
