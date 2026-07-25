/**
 * Deterministic seeded pseudo-random number generator (spec §31). Uses the
 * mulberry32 algorithm over a 32-bit integer state, seeded either directly
 * from a number or from a hash of a string. Never touches `Math.random` or
 * `crypto`, so the exact same sequence of `next()`/`int()`/`pick()`/
 * `shuffle()`/`id()` calls is reproduced for the same seed every time —
 * this is what makes `MockGenerationProvider` (mock-provider.ts) and
 * `prepareRegenerationRequest`'s candidate transforms deterministic (spec
 * §11: "Repeatable output from a seed").
 *
 * `id()` is not part of the brief's minimum `SeededRng` surface
 * (`next`/`int`/`pick`/`shuffle`) but is added so every id generated during
 * AI generation/regeneration can be deterministic too: the domain's
 * `createId()` (`src/domain/score/ids.ts`) calls `crypto.randomUUID()`,
 * which is *not* seeded and would silently break "same seed+request ⇒
 * deep-equal scores" if used inside generation code. Generation code must
 * thread a `SeededRng` through and call `rng.id(prefix)` instead of
 * `createId()` wherever it needs a fresh id.
 */

/**
 * 32-bit string hash (a small cyrb53-style mix), used to turn a string seed
 * into the numeric state `next()` needs. Deterministic across platforms
 * (pure integer arithmetic, no locale/float sensitivity).
 */
function hashStringToUint32(seed: string): number {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

export class SeededRng {
  private state: number;
  private readonly idCounters = new Map<string, number>();
  private readonly seedTag: string;

  constructor(seed: number | string) {
    this.state = (typeof seed === 'number' ? Math.floor(seed) : hashStringToUint32(seed)) >>> 0;
    // Distinguishes ids from other `SeededRng` instances (e.g. one per
    // regeneration candidate index) that would otherwise all start their
    // own id() counters at 0, per-prefix, and collide.
    this.seedTag = this.state.toString(36);
  }

  /** Next pseudo-random float in [0, 1), advancing internal state (mulberry32). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Random integer in `[min, max]`, inclusive of both ends. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`SeededRng.int: max (${max}) is less than min (${min})`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Random element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('SeededRng.pick: array is empty');
    return arr[this.int(0, arr.length - 1)];
  }

  /** Returns a new, Fisher-Yates-shuffled copy of `arr`; never mutates the input. */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /**
   * A deterministic, unique-per-instance id: `${prefix}-${n}` where `n` is a
   * per-prefix incrementing counter. Does not consume `next()`, so calling
   * `id()` never perturbs the `next()`/`int()`/`pick()`/`shuffle()`
   * sequence — a construction that adds an extra `id()` call produces the
   * same musical content as one that doesn't.
   */
  id(prefix: string): string {
    const n = this.idCounters.get(prefix) ?? 0;
    this.idCounters.set(prefix, n + 1);
    return `${prefix}-${this.seedTag}-${n}`;
  }
}
