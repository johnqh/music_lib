/**
 * Promise-based MIDI analyze/import API (spec §15, §29). Offloads parsing/
 * quantization to `workers/midi-import.worker.ts` (a module worker) when
 * `Worker` is available, keeping the main thread responsive for larger
 * files; falls back to calling `adapters/midi/analyze` and
 * `adapters/midi/import` directly (same results, just synchronous-under-a-
 * microtask on the calling thread) when it isn't — notably vitest/jsdom,
 * where `Worker` is undefined, per the Task 7 brief.
 */
import { analyzeMidi } from '../../adapters/midi/analyze.js';
import type { MidiSummary } from '../../adapters/midi/analyze.js';
import { importMidi } from '../../adapters/midi/import.js';
import type { MidiImportResult } from '../../adapters/midi/import.js';
import type { MidiImportOptions } from '../../adapters/midi/import-options.js';
import type { MidiWorkerRequest, MidiWorkerResponse } from '../../workers/midi-import.worker';

type PendingRequest = { resolve: (value: never) => void; reject: (reason: unknown) => void };

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Math.random().toString(36).slice(2)}`;
}

/** Constructs the worker (module-worker URL form, as Vite requires for static analysis); returns `null` if construction throws (e.g. a restrictive CSP). */
function defaultCreateWorker(): Worker | null {
  try {
    return new Worker(new URL('../../workers/midi-import.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

export type MidiServiceOptions = {
  /**
   * Overrides how the worker is constructed. Production code should never
   * need this (the real worker is used automatically whenever `Worker`
   * exists); it exists so tests can inject a fake worker-shaped object
   * without needing a real `Worker` thread or stubbing `globalThis.Worker`.
   * When provided, it's always used (bypassing the `typeof Worker`
   * environment check) — an explicit override is trusted as intentional.
   */
  createWorker?: () => Worker | null;
};

export class MidiService {
  private worker: Worker | null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: MidiServiceOptions = {}) {
    if (options.createWorker) {
      this.worker = options.createWorker();
    } else {
      this.worker = typeof Worker !== 'undefined' ? defaultCreateWorker() : null;
    }
    if (this.worker) {
      this.worker.onmessage = (event: MessageEvent<MidiWorkerResponse>) => this.handleMessage(event.data);
      this.worker.onerror = () => this.rejectAllPending(new Error('MidiService: worker error.'));
    }
  }

  /** Whether requests are actually being offloaded to a worker (vs. the direct-call fallback). Exposed for tests/diagnostics. */
  get usesWorker(): boolean {
    return this.worker !== null;
  }

  private handleMessage(response: MidiWorkerResponse): void {
    const request = this.pending.get(response.requestId);
    if (!request) return;
    this.pending.delete(response.requestId);

    if (response.type === 'error') {
      request.reject(new Error(response.message));
    } else {
      request.resolve(response.result as never);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private sendToWorker<TResult>(request: MidiWorkerRequest): Promise<TResult> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('MidiService: no worker available.'));

    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(request.requestId, { resolve: resolve as (value: never) => void, reject });
      worker.postMessage(request);
    });
  }

  /** Parses and summarizes a MIDI file for the import wizard, without importing it. */
  async analyze(data: ArrayBuffer): Promise<MidiSummary> {
    if (this.worker) {
      return this.sendToWorker<MidiSummary>({ type: 'analyze', requestId: createRequestId(), data });
    }
    return analyzeMidi(data);
  }

  /** Imports a MIDI file as a `Score` per `options` (spec §15). */
  async import(data: ArrayBuffer, options: MidiImportOptions): Promise<MidiImportResult> {
    if (this.worker) {
      return this.sendToWorker<MidiImportResult>({ type: 'import', requestId: createRequestId(), data, options });
    }
    return importMidi(data, options);
  }

  /** Terminates the underlying worker (if any) and rejects any still-pending requests. Safe to call more than once. */
  dispose(): void {
    this.rejectAllPending(new Error('MidiService: disposed.'));
    this.worker?.terminate();
    this.worker = null;
  }
}
