import { describe, expect, it } from 'vitest';
import { GM_INSTRUMENTS } from './gm.js';
import { gmInstrumentIcon } from './gm-icon.js';
import { parseIconPath } from './icon-art.js';

describe('gmInstrumentIcon', () => {
  it('gives every one of the 128 programs art with at least one shape', () => {
    for (const instrument of GM_INSTRUMENTS) {
      expect(gmInstrumentIcon(instrument.program).shapes.length).toBeGreaterThan(0);
    }
  });

  it('uses the hand-picked art for common instruments', () => {
    expect(gmInstrumentIcon(0).name).toBe('piano');
    expect(gmInstrumentIcon(24).name).toBe('guitar');
    expect(gmInstrumentIcon(40).name).toBe('violin');
    expect(gmInstrumentIcon(56).name).toBe('brass');
    expect(gmInstrumentIcon(65).name).toBe('sax');
  });

  it('shares one piece of art across a family with no hand-picked entries', () => {
    const family = GM_INSTRUMENTS.filter((i) => i.family === 'synth-effects');
    expect(new Set(family.map((i) => gmInstrumentIcon(i.program).name)).size).toBe(1);
  });

  it('falls back rather than returning nothing outside the range', () => {
    expect(gmInstrumentIcon(-1).shapes.length).toBeGreaterThan(0);
    expect(gmInstrumentIcon(999).shapes.length).toBeGreaterThan(0);
  });

  it('every path in the set parses, so no icon draws partially', () => {
    // The parser throws on anything outside its subset. Without this, a typo in
    // one icon would surface as a runtime error in the gutter, on the one
    // machine whose track happened to use that program.
    for (const instrument of GM_INSTRUMENTS) {
      for (const shape of gmInstrumentIcon(instrument.program).shapes) {
        if (shape.kind === 'path') expect(() => parseIconPath(shape.d)).not.toThrow();
      }
    }
  });

  it('every coordinate sits inside the 24x24 viewbox', () => {
    // Art that overflows would be clipped in the SVG and would collide with the
    // instrument name beside it in the gutter.
    const seen = new Set<string>();
    for (const instrument of GM_INSTRUMENTS) {
      const art = gmInstrumentIcon(instrument.program);
      if (seen.has(art.name)) continue;
      seen.add(art.name);

      for (const shape of art.shapes) {
        if (shape.kind === 'circle') {
          expect(shape.cx - shape.r, `${art.name} circle`).toBeGreaterThanOrEqual(0);
          expect(shape.cy - shape.r, `${art.name} circle`).toBeGreaterThanOrEqual(0);
          expect(shape.cx + shape.r, `${art.name} circle`).toBeLessThanOrEqual(24);
          expect(shape.cy + shape.r, `${art.name} circle`).toBeLessThanOrEqual(24);
          continue;
        }
        for (const segment of parseIconPath(shape.d)) {
          if (segment.kind === 'close') continue;
          expect(segment.x, `${art.name} path x`).toBeGreaterThanOrEqual(0);
          expect(segment.x, `${art.name} path x`).toBeLessThanOrEqual(24);
          expect(segment.y, `${art.name} path y`).toBeGreaterThanOrEqual(0);
          expect(segment.y, `${art.name} path y`).toBeLessThanOrEqual(24);
        }
      }
    }
  });
});
