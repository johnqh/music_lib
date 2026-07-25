/**
 * Module worker wrapping `quantizeEvents` off the main thread (spec §24,
 * §29), mirroring `workers/midi-import.worker.ts` (Task 7): a thin
 * `postMessage` protocol shim over `domain/quantization/quantize.ts` —
 * every real behavior lives there (directly unit-tested), not here. A
 * single request batches every voice's note group that needs quantizing
 * (one round-trip for a whole manual-quantize action, not one per voice),
 * keyed by an opaque caller-chosen `key` (in practice a voice id) so the
 * response can be matched back up without the worker knowing anything
 * about `Score` shape. vitest/jsdom cannot run real `Worker` threads, so
 * this file itself isn't unit-tested; `services/quantization/quantize-
 * service.ts` has a non-worker fallback that calls `quantizeEvents`
 * directly, which *is* exercised in tests.
 */
import { quantizeEvents } from '../domain/quantization/quantize';
import type { MusicalEvent } from '@sudobility/music_types';
import type { QuantizeOptions } from '../domain/quantization/options';

export type QuantizeEventGroup = { key: string; events: MusicalEvent[] };

export type QuantizeWorkerRequest = {
  type: 'quantize';
  requestId: string;
  groups: QuantizeEventGroup[];
  options: QuantizeOptions;
};

export type QuantizeWorkerResponse =
  | { type: 'quantize'; requestId: string; groups: QuantizeEventGroup[] }
  | { type: 'error'; requestId: string; message: string };

function handleRequest(request: QuantizeWorkerRequest): QuantizeWorkerResponse {
  const groups = request.groups.map((group) => ({
    key: group.key,
    events: quantizeEvents(group.events, request.options),
  }));
  return { type: 'quantize', requestId: request.requestId, groups };
}

self.onmessage = (event: MessageEvent<QuantizeWorkerRequest>) => {
  const request = event.data;
  try {
    self.postMessage(handleRequest(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const response: QuantizeWorkerResponse = { type: 'error', requestId: request.requestId, message };
    self.postMessage(response);
  }
};
