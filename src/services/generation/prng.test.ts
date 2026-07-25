import { describe, expect, it } from 'vitest';
import { SeededRng } from './prng';

describe('SeededRng', () => {
  it('produces the same sequence for the same numeric seed', () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces the same sequence for the same string seed', () => {
    const a = new SeededRng('hello world');
    const b = new SeededRng('hello world');
    expect(a.next()).toBe(b.next());
    expect(a.int(0, 100)).toBe(b.int(0, 100));
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() stays within [0, 1)', () => {
    const rng = new SeededRng('range-check');
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int(min, max) is inclusive of both ends and never out of range', () => {
    const rng = new SeededRng('int-check');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.int(1, 3);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(3);
      seen.add(value);
    }
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it('pick() always returns an element of the array', () => {
    const rng = new SeededRng('pick-check');
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i += 1) {
      expect(arr).toContain(rng.pick(arr));
    }
  });

  it('pick() throws on an empty array', () => {
    const rng = new SeededRng('pick-empty');
    expect(() => rng.pick([])).toThrow();
  });

  it('shuffle() returns a permutation without mutating the input', () => {
    const rng = new SeededRng('shuffle-check');
    const input = [1, 2, 3, 4, 5];
    const result = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect(result).not.toBe(input);
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('shuffle() is deterministic for the same seed', () => {
    const a = new SeededRng('shuffle-seed');
    const b = new SeededRng('shuffle-seed');
    expect(a.shuffle([1, 2, 3, 4, 5, 6])).toEqual(b.shuffle([1, 2, 3, 4, 5, 6]));
  });

  it('id() returns deterministic, per-prefix-incrementing, unique ids for the same seed', () => {
    const a = new SeededRng('id-seed');
    const b = new SeededRng('id-seed');
    expect(a.id('note')).toBe(b.id('note'));
    expect(a.id('note')).toBe(b.id('note'));

    const rng = new SeededRng('id-seed-2');
    const first = rng.id('note');
    const second = rng.id('note');
    expect(first).not.toBe(second);
  });

  it('id() differs across instances constructed with different seeds', () => {
    const a = new SeededRng('seed-a');
    const b = new SeededRng('seed-b');
    expect(a.id('note')).not.toBe(b.id('note'));
  });

  it("id() does not perturb the next()/int()/pick() sequence", () => {
    const withId = new SeededRng('no-perturb');
    const first = withId.next();
    withId.id('x');
    const second = withId.next();

    const withoutId = new SeededRng('no-perturb');
    const firstNoId = withoutId.next();
    const secondNoId = withoutId.next();

    expect(first).toBe(firstNoId);
    expect(second).toBe(secondNoId);
  });
});
