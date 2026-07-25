import { describe, expect, it } from 'vitest';
import { MidiService } from './midi-service.js';
import { analyzeMidi } from '../../adapters/midi/analyze.js';
import { exportMidi } from '../../adapters/midi/export.js';
import { importMidi } from '../../adapters/midi/import.js';
import { defaultMidiImportOptions } from '../../adapters/midi/import-options.js';
import type { MidiWorkerRequest, MidiWorkerResponse } from '../../workers/midi-import.worker';
import { twinkleScore } from '../../test/fixtures.js';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer as ArrayBuffer;
}

/**
 * A worker-shaped fake that actually runs the same adapter functions the
 * real worker wraps, so response payloads are realistic - just without a
 * real Worker thread (unavailable in vitest/jsdom, per the Task 7 brief).
 */
class FakeMidiWorker {
  onmessage: ((event: MessageEvent<MidiWorkerResponse>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  private failNext = false;

  /** Makes the *next* `postMessage` call fire `onerror` instead of resolving - simulates a genuine worker-thread crash (distinct from an application-level error response). */
  crashNext(): void {
    this.failNext = true;
  }

  postMessage(request: MidiWorkerRequest): void {
    if (this.failNext) {
      this.failNext = false;
      queueMicrotask(() => this.onerror?.(new Event('error')));
      return;
    }
    queueMicrotask(() => {
      if (this.terminated) return;
      try {
        const response: MidiWorkerResponse =
          request.type === 'analyze'
            ? { type: 'analyze', requestId: request.requestId, result: analyzeMidi(request.data) }
            : { type: 'import', requestId: request.requestId, result: importMidi(request.data, request.options) };
        this.onmessage?.({ data: response } as MessageEvent<MidiWorkerResponse>);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const response: MidiWorkerResponse = { type: 'error', requestId: request.requestId, message };
        this.onmessage?.({ data: response } as MessageEvent<MidiWorkerResponse>);
      }
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('MidiService (no worker available - the vitest/jsdom fallback path)', () => {
  it('falls back to calling the adapters directly and matches their results exactly', async () => {
    expect(typeof Worker).toBe('undefined'); // sanity: this is genuinely the jsdom-fallback scenario
    const service = new MidiService();
    expect(service.usesWorker).toBe(false);

    const buffer = toArrayBuffer(exportMidi(twinkleScore()));
    const summary = await service.analyze(buffer);
    expect(summary).toEqual(analyzeMidi(buffer));

    const options = defaultMidiImportOptions(summary);
    const result = await service.import(buffer, options);
    const direct = importMidi(buffer, options);
    expect(result.score.tracks.map((t) => t.name)).toEqual(direct.score.tracks.map((t) => t.name));
    expect(result.warnings).toEqual(direct.warnings);

    expect(() => service.dispose()).not.toThrow(); // no-op without a worker
  });
});

describe('MidiService (simulated worker, via DI)', () => {
  it('routes analyze()/import() requests through the worker and resolves with its response', async () => {
    const fake = new FakeMidiWorker();
    const service = new MidiService({ createWorker: () => fake as unknown as Worker });
    expect(service.usesWorker).toBe(true);

    const buffer = toArrayBuffer(exportMidi(twinkleScore()));
    const summary = await service.analyze(buffer);
    expect(summary).toEqual(analyzeMidi(buffer));

    const options = defaultMidiImportOptions(summary);
    const result = await service.import(buffer, options);
    const direct = importMidi(buffer, options);
    expect(result.score.tracks.map((t) => t.name)).toEqual(direct.score.tracks.map((t) => t.name));
    expect(result.warnings).toEqual(direct.warnings);
  });

  it('matches concurrent requests to their own response by requestId', async () => {
    const fake = new FakeMidiWorker();
    const service = new MidiService({ createWorker: () => fake as unknown as Worker });
    const buffer = toArrayBuffer(exportMidi(twinkleScore()));

    const [a, b, c] = await Promise.all([service.analyze(buffer), service.analyze(buffer), service.analyze(buffer)]);
    expect(a).toEqual(analyzeMidi(buffer));
    expect(b).toEqual(analyzeMidi(buffer));
    expect(c).toEqual(analyzeMidi(buffer));
  });

  it('rejects the in-flight request when the worker reports onerror', async () => {
    const fake = new FakeMidiWorker();
    const service = new MidiService({ createWorker: () => fake as unknown as Worker });
    fake.crashNext();

    const buffer = toArrayBuffer(exportMidi(twinkleScore()));
    await expect(service.analyze(buffer)).rejects.toThrow('worker error');
  });

  it('dispose() terminates the worker and rejects any still-pending request', async () => {
    const fake = new FakeMidiWorker();
    const service = new MidiService({ createWorker: () => fake as unknown as Worker });
    const buffer = toArrayBuffer(exportMidi(twinkleScore()));

    const pending = service.analyze(buffer);
    service.dispose();

    await expect(pending).rejects.toThrow('disposed');
    expect(fake.terminated).toBe(true);
  });
});
