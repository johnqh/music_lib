import { describe, expect, it } from 'vitest';
import { QuantizeService } from './quantize-service.js';
import { quantizeEvents } from '../../domain/quantization/quantize.js';
import type { MusicalEvent } from '@sudobility/music_types';
import type { QuantizeOptions } from '../../domain/quantization/options.js';
import type { QuantizeEventGroup, QuantizeWorkerRequest, QuantizeWorkerResponse } from '../../workers/quantize.worker';

function note(id: string, startTick: number, durationTicks: number, voiceId = 'v1', trackId = 't1'): MusicalEvent {
  return {
    id,
    pitch: { step: 'C', accidental: 0, octave: 4 },
    startTick,
    durationTicks,
    velocity: 80,
    voiceId,
    trackId,
  };
}

const OPTIONS: QuantizeOptions = { grid: 480, quantizeStarts: true, quantizeDurations: false };

/** A worker-shaped fake that actually runs `quantizeEvents` (the same function the real worker wraps), mirroring `midi-service.test.ts`'s `FakeMidiWorker` — no real `Worker` thread (unavailable in vitest/jsdom). */
class FakeQuantizeWorker {
  onmessage: ((event: MessageEvent<QuantizeWorkerResponse>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  private failNext = false;

  crashNext(): void {
    this.failNext = true;
  }

  postMessage(request: QuantizeWorkerRequest): void {
    if (this.failNext) {
      this.failNext = false;
      queueMicrotask(() => this.onerror?.(new Event('error')));
      return;
    }
    queueMicrotask(() => {
      if (this.terminated) return;
      try {
        const groups: QuantizeEventGroup[] = request.groups.map((g) => ({
          key: g.key,
          events: quantizeEvents(g.events, request.options),
        }));
        const response: QuantizeWorkerResponse = { type: 'quantize', requestId: request.requestId, groups };
        this.onmessage?.({ data: response } as MessageEvent<QuantizeWorkerResponse>);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const response: QuantizeWorkerResponse = { type: 'error', requestId: request.requestId, message };
        this.onmessage?.({ data: response } as MessageEvent<QuantizeWorkerResponse>);
      }
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('QuantizeService (no worker available - the vitest/jsdom fallback path)', () => {
  it('falls back to calling quantizeEvents directly per group and matches its results exactly', async () => {
    expect(typeof Worker).toBe('undefined'); // sanity: genuinely the jsdom-fallback scenario
    const service = new QuantizeService();
    expect(service.usesWorker).toBe(false);

    const groups = [
      { key: 'v1', events: [note('n1', 50, 480)] },
      { key: 'v2', events: [note('n2', 530, 480, 'v2')] },
    ];
    const result = await service.quantizeGroups(groups, OPTIONS);

    expect(result.get('v1')).toEqual(quantizeEvents(groups[0].events, OPTIONS));
    expect(result.get('v2')).toEqual(quantizeEvents(groups[1].events, OPTIONS));
  });

  it('resolves an empty map for an empty groups list without dispatching anything', async () => {
    const service = new QuantizeService();
    expect(await service.quantizeGroups([], OPTIONS)).toEqual(new Map());
  });
});

describe('QuantizeService (simulated worker, via DI)', () => {
  it('routes quantizeGroups() through the worker in a single batched round-trip', async () => {
    const fake = new FakeQuantizeWorker();
    const service = new QuantizeService({ createWorker: () => fake as unknown as Worker });
    expect(service.usesWorker).toBe(true);

    const groups = [
      { key: 'v1', events: [note('n1', 50, 480)] },
      { key: 'v2', events: [note('n2', 530, 480, 'v2')] },
    ];
    const result = await service.quantizeGroups(groups, OPTIONS);

    expect(result.get('v1')).toEqual(quantizeEvents(groups[0].events, OPTIONS));
    expect(result.get('v2')).toEqual(quantizeEvents(groups[1].events, OPTIONS));
  });

  it('rejects the in-flight request when the worker reports onerror', async () => {
    const fake = new FakeQuantizeWorker();
    const service = new QuantizeService({ createWorker: () => fake as unknown as Worker });
    fake.crashNext();

    await expect(service.quantizeGroups([{ key: 'v1', events: [note('n1', 0, 480)] }], OPTIONS)).rejects.toThrow(
      'worker error',
    );
  });

  it('dispose() terminates the worker and rejects any still-pending request', async () => {
    const fake = new FakeQuantizeWorker();
    const service = new QuantizeService({ createWorker: () => fake as unknown as Worker });

    const pending = service.quantizeGroups([{ key: 'v1', events: [note('n1', 0, 480)] }], OPTIONS);
    service.dispose();

    await expect(pending).rejects.toThrow('disposed');
    expect(fake.terminated).toBe(true);
  });
});
