/**
 * Module worker wrapping `transcribe` off the main thread, mirroring
 * `workers/quantize.worker.ts`: a thin `postMessage` protocol shim over
 * `domain/audio/transcribe.ts`, where every real behaviour lives and is
 * directly unit-tested.
 *
 * This one exists for a reason the others do not share. Pitch tracking is a
 * tight numeric loop — O(frames x tau x window) — that runs for seconds on a
 * real recording and **cannot yield**: that is what makes it fast. Run on the
 * main thread it blocks every repaint, so a progress bar driven from inside it
 * would not move a pixel until the moment it finished. Off the main thread the
 * same loop can report as often as it likes and the bar actually animates.
 *
 * vitest/jsdom cannot run real `Worker` threads, so this file is not unit-
 * tested; `services/transcription/transcribe-service.ts` has a non-worker
 * fallback that calls `transcribe` directly, which is.
 */
import { transcribe } from '../domain/audio/transcribe.js';
import type { Transcription } from '../domain/audio/transcribe.js';

export type TranscribeWorkerRequest = {
  type: 'transcribe';
  requestId: string;
  samples: Float32Array;
  sampleRate: number;
  ppq: number;
};

export type TranscribeWorkerResponse =
  | { type: 'progress'; requestId: string; fraction: number }
  | { type: 'transcribe'; requestId: string; transcription: Transcription }
  | { type: 'error'; requestId: string; message: string };

self.onmessage = (event: MessageEvent<TranscribeWorkerRequest>) => {
  const request = event.data;
  if (request?.type !== 'transcribe') return;

  try {
    const transcription = transcribe(
      { samples: request.samples, sampleRate: request.sampleRate },
      request.ppq,
      (fraction) => {
        const message: TranscribeWorkerResponse = {
          type: 'progress',
          requestId: request.requestId,
          fraction,
        };
        self.postMessage(message);
      },
    );
    const done: TranscribeWorkerResponse = {
      type: 'transcribe',
      requestId: request.requestId,
      transcription,
    };
    self.postMessage(done);
  } catch (error) {
    const failed: TranscribeWorkerResponse = {
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(failed);
  }
};
