import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from './ids';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createId', () => {
  it('returns a v4-UUID-shaped string', () => {
    expect(createId()).toMatch(UUID_V4_PATTERN);
  });

  it('returns a different id on each call', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createId()));
    expect(ids.size).toBe(50);
  });

  it('uses crypto.randomUUID when available', () => {
    const spy = vi.spyOn(crypto, 'randomUUID');
    createId();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('falls back to a Math.random-based id when crypto.randomUUID is unavailable', () => {
    const original = crypto.randomUUID;
    // @ts-expect-error simulating a non-secure context where randomUUID is absent
    delete crypto.randomUUID;
    try {
      expect(createId()).toMatch(UUID_V4_PATTERN);
    } finally {
      crypto.randomUUID = original;
    }
  });
});
