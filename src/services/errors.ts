/**
 * Centralized error handling (spec §28): a small `AppError` taxonomy for
 * call sites that want to attach a stable `code` and a clear, non-technical
 * `userMessage` to a failure, plus `reportError` — the single function that
 * turns *any* thrown value (an `AppError` or not) into a toast, with the
 * raw error logged via `console.debug` in development only (spec §28:
 * "Clear error messages without raw stack traces for ordinary users; log
 * technical details in development mode").
 *
 * Call sites: audio initialization (`playback/controller.ts` already does
 * its own toast-on-failure; this module is for the app-shell-level sites
 * this task owns), MIDI/MusicXML import, project persistence (create/open/
 * save/duplicate/delete/import-json), and generation failures surfaced
 * outside `generation-slice`'s own `error` field (e.g. a request that
 * throws before `generate()`/`regenerate()` even starts).
 */
import { useAppStore } from '../store/useAppStore.js';
import type { createAppStore } from '../store/useAppStore.js';

/** Stable, machine-readable failure categories (spec §28's list). */
export type AppErrorCode =
  | 'midi-import'
  | 'midi-export'
  | 'musicxml-import'
  | 'musicxml-export'
  | 'project-load'
  | 'project-save'
  | 'project-data'
  | 'audio-init'
  | 'generation'
  | 'storage-quota'
  | 'rendering'
  | 'unsupported-feature'
  | 'unknown';

export type AppErrorOptions = {
  code: AppErrorCode;
  /** Shown to the user, verbatim, in a toast — never a raw stack trace or exception class name. */
  userMessage: string;
  /** Technical detail (the original error, Zod issues, ...), logged via `console.debug` only in development. */
  detail?: unknown;
};

/** A taxonomized application error (spec §28). Thrown by call sites that already know *why* an operation failed and want the UI to show something clearer than a raw `Error.message`. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly detail?: unknown;

  constructor(options: AppErrorOptions) {
    super(options.userMessage);
    this.name = 'AppError';
    this.code = options.code;
    this.userMessage = options.userMessage;
    this.detail = options.detail;
  }
}

/** The store shape `reportError` needs: enough to push a toast (matches every other module's `createAppStore()`-shaped DI convention). */
export type ErrorReportingStoreApi = ReturnType<typeof createAppStore>;

export type ReportErrorOptions = {
  /** Prefixed onto the resolved message, e.g. "Import failed". */
  context?: string;
  /** Defaults to the app-wide singleton; tests inject an isolated store via `createAppStore()`. */
  store?: ErrorReportingStoreApi;
  /** Surfaced as a "Retry" action button on the toast (spec §28: "retry actions where appropriate"). */
  retry?: () => void;
  retryLabel?: string;
};

/** The message shown to the user: an `AppError`'s own `userMessage`, or a plain `Error`'s `message`, or a best-effort `String(err)` for anything else — never a raw stack trace. */
export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.userMessage;
  if (err instanceof Error) return err.message;
  return String(err);
}

let logTechnicalDetail = false;

/**
 * Turns the development-only `console.debug` of raw errors on or off. Off
 * until the app says otherwise.
 *
 * This used to read `import.meta.env.DEV` and decide for itself. That is a
 * sniff of one specific bundler, in a package that is supposed to know nothing
 * about its host — and worse, `import.meta` is syntax rather than a value, so
 * React Native's bundler failed to parse this module rather than falling back.
 * The app knows whether it is a dev build; it passes that in.
 * See `platform/workers.ts`, which moved for the same reason.
 */
export function setErrorLogging(enabled: boolean): void {
  logTechnicalDetail = enabled;
}

/**
 * Reports `err` to the user (a toast, via `store.pushToast`) and, in
 * development only, to the console with full technical detail (spec §28).
 * Safe to call for any thrown value, not just `AppError`.
 */
export function reportError(err: unknown, options: ReportErrorOptions = {}): void {
  const store = options.store ?? useAppStore;
  const detail = toUserMessage(err);
  const message = options.context ? `${options.context}: ${detail}` : detail;

  store.getState().pushToast({
    message,
    severity: 'error',
    ...(options.retry ? { action: { label: options.retryLabel ?? 'Retry', onClick: options.retry } } : {}),
  });

  if (logTechnicalDetail) {
    console.debug('[ScoreSmith error]', options.context ?? '(no context)', err);
  }
}
