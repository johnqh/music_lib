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
 */

export type LibraryMessages = {
  /** Action label on a retryable error toast. */
  retry: string;
  /** Autosave to the server failed; the change is still held locally. */
  saveFailed: string;
  /** The transport could not start. */
  playbackFailed: string;
  /** The score could not be handed to the playback engine. */
  scoreLoadFailed: string;
  /** An authenticated call was attempted while signed out. */
  authRequired: string;
};

/**
 * Empty until the host says otherwise.
 *
 * Empty rather than English: a missing message then shows as nothing at all,
 * which is visible in review, where a plausible English default would ship
 * silently in a Chinese build and look like a translation someone forgot.
 */
let messages: LibraryMessages = {
  retry: '',
  saveFailed: '',
  playbackFailed: '',
  scoreLoadFailed: '',
  authRequired: '',
};

/** Called once at bootstrap by the host application. */
export function setLibraryMessages(next: LibraryMessages): void {
  messages = next;
}

export function libraryMessage(key: keyof LibraryMessages): string {
  return messages[key];
}
