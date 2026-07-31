/**
 * Module worker wrapping MIDI analyze/import off the main thread (spec §15,
 * §29). Deliberately thin: a `postMessage` protocol shim over
 * `adapters/midi/analyze` and `adapters/midi/import` — every real behavior
 * lives in those (directly unit-tested) modules, not here. vitest/jsdom
 * The message carries an already-decoded `MidiFile`, not raw bytes: decoding
 * needs a `MidiCodec`, which is not structured-cloneable, and importing one
 * here would make music_lib depend on music_io. Parsing is cheap; the
 * quantization and voice allocation this offloads are not. vitest/jsdom
 * cannot run real `Worker` threads, so this file itself isn't
 * unit-tested; `services/import-export/midi-service.ts` has a non-worker
 * fallback that calls the same two adapter functions directly, which *is*
 * exercised in tests.
 */
import { analyzeMidiFile } from '../adapters/midi/analyze.js';
import type { MidiSummary } from '../adapters/midi/analyze.js';
import { importMidiFile } from '../adapters/midi/import.js';
import type { MidiImportResult } from '../adapters/midi/import.js';
import type { MidiImportOptions } from '../adapters/midi/import-options.js';
import type { MidiFile } from '@sudobility/music_types';

export type MidiWorkerRequest =
  | { type: 'analyze'; requestId: string; midi: MidiFile }
  | { type: 'import'; requestId: string; midi: MidiFile; options: MidiImportOptions };

export type MidiWorkerResponse =
  | { type: 'analyze'; requestId: string; result: MidiSummary }
  | { type: 'import'; requestId: string; result: MidiImportResult }
  | { type: 'error'; requestId: string; message: string };

function handleRequest(request: MidiWorkerRequest): MidiWorkerResponse {
  if (request.type === 'analyze') {
    return { type: 'analyze', requestId: request.requestId, result: analyzeMidiFile(request.midi) };
  }
  return { type: 'import', requestId: request.requestId, result: importMidiFile(request.midi, request.options) };
}

self.onmessage = (event: MessageEvent<MidiWorkerRequest>) => {
  const request = event.data;
  try {
    self.postMessage(handleRequest(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const response: MidiWorkerResponse = { type: 'error', requestId: request.requestId, message };
    self.postMessage(response);
  }
};
