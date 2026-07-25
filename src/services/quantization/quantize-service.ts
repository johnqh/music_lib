/**
 * Promise-based batched-quantize API (spec §24, §29). Offloads
 * `quantizeEvents` to `workers/quantize.worker.ts` (a module worker) when
 * `Worker` is available, keeping the main thread responsive when a manual
 * quantize action touches a large number of events; falls back to calling
 * `domain/quantization/quantize.ts`'s `quantizeEvents` directly (same
 * results, just synchronous-under-a-microtask on the calling thread) when
 * it isn't — notably vitest/jsdom, where `Worker` is undefined. Mirrors
 * `services/import-export/midi-service.ts` (Task 7) exactly; see that
 * file's doc comment for the pattern this follows.
 */
import { quantizeEvents } from '../../domain/quantization/quantize.js';
import type { MusicalEvent } from '@sudobility/music_types';
import type { QuantizeOptions } from '../../domain/quantization/options.js';
import type {
  QuantizeEventGroup,
  QuantizeWorkerRequest,
  QuantizeWorkerResponse,
} from '../../workers/quantize.worker';

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
    return new Worker(new URL('../../workers/quantize.worker.js', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

export type QuantizeServiceOptions = {
  /**
   * Overrides how the worker is constructed. Production code should never
   * need this (the real worker is used automatically whenever `Worker`
   * exists); it exists so tests can inject a fake worker-shaped object
   * without needing a real `Worker` thread. When provided, it's always
   * used (bypassing the `typeof Worker` environment check) — an explicit
   * override is trusted as intentional.
   */
  createWorker?: () => Worker | null;
};

export class QuantizeService {
  private worker: Worker | null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: QuantizeServiceOptions = {}) {
    if (options.createWorker) {
      this.worker = options.createWorker();
    } else {
      this.worker = typeof Worker !== 'undefined' ? defaultCreateWorker() : null;
    }
    if (this.worker) {
      this.worker.onmessage = (event: MessageEvent<QuantizeWorkerResponse>) => this.handleMessage(event.data);
      this.worker.onerror = () => this.rejectAllPending(new Error('QuantizeService: worker error.'));
    }
  }

  /** Whether requests are actually being offloaded to a worker (vs. the direct-call fallback). Exposed for tests/diagnostics. */
  get usesWorker(): boolean {
    return this.worker !== null;
  }

  private handleMessage(response: QuantizeWorkerResponse): void {
    const request = this.pending.get(response.requestId);
    if (!request) return;
    this.pending.delete(response.requestId);

    if (response.type === 'error') {
      request.reject(new Error(response.message));
    } else {
      request.resolve(response.groups as never);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  /**
   * Quantizes every group in `groups` (each `{key, events}` — in practice
   * one group per voice touched by a selection) against the same `options`,
   * in a single worker round-trip, resolving with a `Map` from each group's
   * `key` back to its quantized events (order not guaranteed to match
   * `groups`' input order). Falls back to calling `quantizeEvents` directly,
   * synchronously per group, when no worker is available.
   */
  async quantizeGroups(
    groups: QuantizeEventGroup[],
    options: QuantizeOptions,
  ): Promise<Map<string, MusicalEvent[]>> {
    if (groups.length === 0) return new Map();

    if (!this.worker) {
      return new Map(groups.map((group) => [group.key, quantizeEvents(group.events, options)] as const));
    }

    const worker = this.worker;
    const requestId = createRequestId();
    const request: QuantizeWorkerRequest = { type: 'quantize', requestId, groups, options };

    const resultGroups = await new Promise<QuantizeEventGroup[]>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (value: never) => void, reject });
      worker.postMessage(request);
    });

    return new Map(resultGroups.map((group) => [group.key, group.events] as const));
  }

  /** Terminates the underlying worker (if any) and rejects any still-pending requests. Safe to call more than once. */
  dispose(): void {
    this.rejectAllPending(new Error('QuantizeService: disposed.'));
    this.worker?.terminate();
    this.worker = null;
  }
}

let singleton: QuantizeService | null = null;

/**
 * The app-wide `QuantizeService` singleton, created lazily on first use (not
 * at module load) so importing `editing.ts`/`interactions.ts` doesn't spin
 * up a worker before any quantize action actually needs one. Intent-layer
 * callers (`quantizeSelection`, `commitQuantize`) use this by default; tests
 * inject their own instance instead.
 */
export function getQuantizeService(): QuantizeService {
  if (!singleton) singleton = new QuantizeService();
  return singleton;
}
