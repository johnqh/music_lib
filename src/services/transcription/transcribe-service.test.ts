import { describe, expect, it, vi } from 'vitest';
import { TranscribeService } from './transcribe-service.js';
import type { TranscribeWorkerRequest } from '../../workers/transcribe.worker.js';

/** A 440Hz tone: the same signal `transcribe`'s own tests use. */
function tone(seconds = 0.6, hz = 440, sampleRate = 44100): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate) * 0.6;
  }
  return samples;
}

/** A worker-shaped fake: records what it was posted, replies on demand. */
function fakeWorker() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const posted: TranscribeWorkerRequest[] = [];
  const transfers: unknown[][] = [];
  return {
    posted,
    transfers,
    reply(message: unknown) {
      for (const listener of listeners) listener({ data: message } as MessageEvent);
    },
    worker: {
      addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: (event: MessageEvent) => void) =>
        listeners.delete(fn),
      postMessage: (message: TranscribeWorkerRequest, transfer?: unknown[]) => {
        posted.push(message);
        transfers.push(transfer ?? []);
      },
      terminate: vi.fn(),
    } as unknown as Worker,
    listenerCount: () => listeners.size,
  };
}

describe('TranscribeService without a worker', () => {
  it('still transcribes, and still reports progress', async () => {
    // jsdom has no `Worker`. The same code path has to work, or every test of
    // anything that transcribes would need a worker thread.
    const service = new TranscribeService({ createWorker: () => null });
    const seen: number[] = [];

    const result = await service.transcribe({ samples: tone(), sampleRate: 44100 }, 480, {
      onProgress: (f) => seen.push(f),
    });

    expect(result.notes.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(1);
  });
});

describe('TranscribeService with a worker', () => {
  it('reports every progress message, then resolves on the result', async () => {
    const fake = fakeWorker();
    const service = new TranscribeService({ createWorker: () => fake.worker });
    const seen: number[] = [];

    const pending = service.transcribe({ samples: tone(0.1), sampleRate: 44100 }, 480, {
      onProgress: (f) => seen.push(f),
    });
    const { requestId } = fake.posted[0];
    fake.reply({ type: 'progress', requestId, fraction: 0.25 });
    fake.reply({ type: 'progress', requestId, fraction: 0.75 });
    fake.reply({
      type: 'transcribe',
      requestId,
      transcription: { bpm: 120, notes: [] },
    });

    await expect(pending).resolves.toEqual({ bpm: 120, notes: [] });
    expect(seen).toEqual([0.25, 0.75]);
  });

  it('transfers the samples rather than copying them', async () => {
    // A few minutes of audio is tens of megabytes, and the caller has no
    // further use for the buffer once the transcription comes back.
    const fake = fakeWorker();
    const service = new TranscribeService({ createWorker: () => fake.worker });
    const samples = tone(0.1);

    const pending = service.transcribe({ samples, sampleRate: 44100 }, 480);
    expect(fake.transfers[0]).toEqual([samples.buffer]);

    fake.reply({
      type: 'transcribe',
      requestId: fake.posted[0].requestId,
      transcription: { bpm: 120, notes: [] },
    });
    await pending;
  });

  it('rejects on a worker error, and stops listening either way', async () => {
    // A listener left attached per request would accumulate one per import.
    const fake = fakeWorker();
    const service = new TranscribeService({ createWorker: () => fake.worker });

    const pending = service.transcribe({ samples: tone(0.1), sampleRate: 44100 }, 480);
    fake.reply({
      type: 'error',
      requestId: fake.posted[0].requestId,
      message: 'that is not audio',
    });

    await expect(pending).rejects.toThrow('that is not audio');
    expect(fake.listenerCount()).toBe(0);
  });

  it('ignores messages belonging to another request', async () => {
    const fake = fakeWorker();
    const service = new TranscribeService({ createWorker: () => fake.worker });
    const seen: number[] = [];

    const pending = service.transcribe({ samples: tone(0.1), sampleRate: 44100 }, 480, {
      onProgress: (f) => seen.push(f),
    });
    fake.reply({ type: 'progress', requestId: 'someone-else', fraction: 0.5 });
    fake.reply({
      type: 'transcribe',
      requestId: fake.posted[0].requestId,
      transcription: { bpm: 90, notes: [] },
    });

    await pending;
    expect(seen).toEqual([]);
  });
});
