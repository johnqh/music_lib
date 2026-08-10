import { describe, expect, it } from 'vitest';
import { GM_KITS, gmKit, gmKitAt } from './gm-kit.js';
import { gmInstrument } from './gm.js';

describe('gmKit', () => {
  it('has the eight kits General MIDI defines, at their own addresses', () => {
    expect(GM_KITS.map((k) => k.program)).toEqual([0, 8, 16, 24, 25, 32, 40, 48]);
    for (const kit of GM_KITS) expect(gmKit(kit.program)).toEqual(kit);
  });

  it('is null where no kit is defined, rather than guessing', () => {
    // The exact lookup is what the picker uses to tell "this score names a kit"
    // from "this score names an address that is not one".
    expect(gmKit(1)).toBeNull();
    expect(gmKit(45)).toBeNull();
    expect(gmKit(127)).toBeNull();
  });

  it('never shares a name with the melodic program at the same address', () => {
    // The whole failure this catalogue exists for: kit 40 is Brush, and
    // program 40 is Violin. If a kit ever resolved through the instrument
    // table the two would agree, and that agreement is the bug.
    for (const kit of GM_KITS) {
      expect(kit.name).not.toBe(gmInstrument(kit.program)?.name);
    }
  });
});

describe('gmKitAt', () => {
  it('resolves an address to the kit whose region contains it', () => {
    // How General MIDI hardware reads a program change to an address it has no
    // kit at, and how a MIDI file that does exactly that gets a kit.
    expect(gmKitAt(0).name).toBe('Standard Kit');
    expect(gmKitAt(3).name).toBe('Standard Kit');
    expect(gmKitAt(24).name).toBe('Electronic Kit');
    expect(gmKitAt(25).name).toBe('TR-808 Kit');
    expect(gmKitAt(31).name).toBe('TR-808 Kit'); // 25's region runs to 32, not to 26
    expect(gmKitAt(45).name).toBe('Brush Kit');
    expect(gmKitAt(127).name).toBe('Orchestra Kit');
  });

  it('falls back to Standard for a number that is not one', () => {
    // Every font has Standard, so it is the only safe answer for a hand-edited
    // score. Returning null instead would push the decision to every caller.
    expect(gmKitAt(Number.NaN).name).toBe('Standard Kit');
    expect(gmKitAt(-1).name).toBe('Standard Kit');
  });
});
