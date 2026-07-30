import { describe, expect, it } from 'vitest';
import { GM_INSTRUMENTS } from './gm.js';
import { gmInstrumentEmoji } from './gm-icon.js';

describe('gmInstrumentEmoji', () => {
  it('gives every one of the 128 programs a non-empty glyph', () => {
    for (const instrument of GM_INSTRUMENTS) {
      expect(gmInstrumentEmoji(instrument.program).length).toBeGreaterThan(0);
    }
  });

  it('uses the hand-picked glyph for common instruments', () => {
    expect(gmInstrumentEmoji(0)).toBe('🎹');
    expect(gmInstrumentEmoji(24)).toBe('🎸');
    expect(gmInstrumentEmoji(40)).toBe('🎻');
    expect(gmInstrumentEmoji(56)).toBe('🎺');
    expect(gmInstrumentEmoji(65)).toBe('🎷');
  });

  it('shares one glyph across a family with no hand-picked entries', () => {
    const family = GM_INSTRUMENTS.filter((i) => i.family === 'synth-effects');
    expect(new Set(family.map((i) => gmInstrumentEmoji(i.program))).size).toBe(1);
  });

  it('falls back rather than returning empty outside the range', () => {
    expect(gmInstrumentEmoji(-1).length).toBeGreaterThan(0);
    expect(gmInstrumentEmoji(999).length).toBeGreaterThan(0);
  });
});
