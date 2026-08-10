/**
 * Promise-based audio transcription with progress.
 *
 * Offloads `transcribe` to `workers/transcribe.worker.ts` when `Worker` is
 * available and falls back to calling it directly when it is not — notably
 * vitest/jsdom, where `Worker` is undefined. Mirrors
 * `services/quantization/quantize-service.ts`; see that file for the pattern.
 *
 * The worker is not an optimisation here, it is what makes the progress real.
 * Pitch tracking is a tight numeric loop that cannot yield, so on the main
 * thread nothing repaints until it is over: a bar fed from the fallback path
 * jumps straight from 0 to 1 and is honest about it, while the same bar fed
 * from the worker actually crosses the screen. Both paths report, so a caller
 * writes one piece of code either way.
 */
import { transcribe } from '../../domain/audio/transcribe.js';
import type { Transcription } from '../../domain/audio/transcribe.js';
import type { DecodedAudio } from '@sudobility/music_types';
import type {
  TranscribeWorkerRequest,
  TranscribeWorkerResponse,
} from '../../workers/transcribe.worker';

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Math.random().toString(36).slice(2)}`;
}

/** Module-worker URL form, as Vite requires for static analysis; `null` if construction throws (e.g. a restrictive CSP). */
function defaultCreateWorker(): Worker | null {
  try {
    return new Worker(new URL('../../workers/transcribe.worker.js', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

export type TranscribeServiceOptions = {
  /** Overrides worker construction, so a test can inject a worker-shaped fake. */
  createWorker?: () => Worker | null;
};

export type TranscribeOptions = {
  /** Reports analysis progress, 0..1. */
  onProgress?: (fraction: number) => void;
};

export class TranscribeService {
  private worker: Worker | null;

  constructor(options: TranscribeServiceOptions = {}) {
    if (options.createWorker) {
      this.worker = options.createWorker();
    } else {
      this.worker = typeof Worker !== 'undefined' ? defaultCreateWorker() : null;
    }
  }

  async transcribe(
    audio: DecodedAudio,
    ppq: number,
    options: TranscribeOptions = {},
  ): Promise<Transcription> {
    const worker = this.worker;
    if (!worker) {
      // Same results, on this thread. The progress callback still fires, so
      // the caller's code is identical — it simply cannot paint between calls.
      return transcribe(audio, ppq, options.onProgress);
    }

    const requestId = createRequestId();
    return await new Promise<Transcription>((resolve, reject) => {
      const onMessage = (event: MessageEvent<TranscribeWorkerResponse>): void => {
        const message = event.data;
        if (!message || message.requestId !== requestId) return;

        if (message.type === 'progress') {
          options.onProgress?.(message.fraction);
          return;
        }

        // Only a terminal message detaches the listener; progress messages
        // keep arriving until one does.
        worker.removeEventListener('message', onMessage);
        if (message.type === 'transcribe') resolve(message.transcription);
        else reject(new Error(message.message));
      };

      worker.addEventListener('message', onMessage);
      const request: TranscribeWorkerRequest = {
        type: 'transcribe',
        requestId,
        samples: audio.samples,
        sampleRate: audio.sampleRate,
        ppq,
      };
      // Transferred, not copied: a few minutes of audio is tens of megabytes,
      // and the caller has no further use for the buffer once it is handed
      // over — the transcription that comes back is what it wanted.
      worker.postMessage(request, [audio.samples.buffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
