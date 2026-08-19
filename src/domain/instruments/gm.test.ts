import { describe, expect, it } from 'vitest';
import {
  GM_FAMILIES,
  GM_FAMILY_LABELS,
  GM_INSTRUMENTS,
  gmFamilyOf,
  gmInstrument,
  gmInstrumentsByFamily,
} from './gm.js';

describe('GM_INSTRUMENTS', () => {
  it('has exactly 128 entries, in program order', () => {
    expect(GM_INSTRUMENTS).toHaveLength(128);
    GM_INSTRUMENTS.forEach((instrument, i) => {
      expect(instrument.program).toBe(i);
    });
  });

  it('gives every entry a non-empty name', () => {
    for (const instrument of GM_INSTRUMENTS) {
      expect(instrument.name.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate names', () => {
    expect(new Set(GM_INSTRUMENTS.map(i => i.name)).size).toBe(128);
  });

  it('anchors on the well-known General MIDI assignments', () => {
    expect(gmInstrument(0)!.name).toBe('Acoustic Grand Piano');
    expect(gmInstrument(24)!.name).toBe('Acoustic Guitar (nylon)');
    expect(gmInstrument(40)!.name).toBe('Violin');
    expect(gmInstrument(56)!.name).toBe('Trumpet');
    expect(gmInstrument(73)!.name).toBe('Flute');
    expect(gmInstrument(127)!.name).toBe('Gunshot');
  });
});

describe('families', () => {
  it('has 16 families of 8', () => {
    expect(GM_FAMILIES).toHaveLength(16);
    for (const family of GM_FAMILIES) {
      expect(gmInstrumentsByFamily(family)).toHaveLength(8);
    }
  });

  it('labels every family', () => {
    for (const family of GM_FAMILIES) {
      expect(GM_FAMILY_LABELS[family].length).toBeGreaterThan(0);
    }
  });

  it('agrees between gmFamilyOf and the table, for all 128', () => {
    for (const instrument of GM_INSTRUMENTS) {
      expect(gmFamilyOf(instrument.program)).toBe(instrument.family);
    }
  });

  it('assigns the first eight programs to piano and the last eight to sound effects', () => {
    expect(gmFamilyOf(0)).toBe('piano');
    expect(gmFamilyOf(7)).toBe('piano');
    expect(gmFamilyOf(120)).toBe('sound-effects');
    expect(gmFamilyOf(127)).toBe('sound-effects');
  });

  it('returns each family group in program order', () => {
    const guitars = gmInstrumentsByFamily('guitar');
    expect(guitars.map(g => g.program)).toEqual([
      24, 25, 26, 27, 28, 29, 30, 31,
    ]);
  });
});

describe('gmInstrument', () => {
  it('resolves every valid program', () => {
    for (let program = 0; program < 128; program += 1) {
      expect(gmInstrument(program)).not.toBeNull();
    }
  });

  it('returns null outside 0-127 rather than throwing', () => {
    // Track.midiProgram is schema-validated to 0-127, so this guards against a
    // hand-edited score, not an expected path.
    expect(gmInstrument(-1)).toBeNull();
    expect(gmInstrument(128)).toBeNull();
    expect(gmInstrument(1.5)).toBeNull();
  });
});
