import { describe, expect, it } from 'vitest';
import { CanvasScoreRenderer } from './canvas-renderer.js';
import { computeLayout } from './layout.js';
import type { RenderTheme } from './types.js';
import { createMock2DContext } from '../../test/canvas-stub.js';
import { stressScore, twinkleScore } from '../../test/fixtures.js';
import { allNotes } from '../../domain/score/queries.js';

const THEME: RenderTheme = { foreground: '#000', selection: '#00f', playback: '#f00', preview: '#999' };
const OPTS = {
  zoom: 1,
  layoutMode: 'page' as const,
  width: 900,
  theme: THEME,
  viewport: { top: 0, bottom: 400 },
};

describe('CanvasScoreRenderer', () => {
  it('draws only the systems intersecting the viewport', () => {
    const score = stressScore(1, 80);
    const plan = computeLayout(score, OPTS);
    const renderer = new CanvasScoreRenderer();
    const result = renderer.render(score, createMock2DContext(), OPTS);
    const expectedVisible = plan.systems
      .filter((s) => s.yBottom >= 0 && s.yTop <= 400)
      .flatMap((s) => s.measureIndices);
    expect([...result.drawnMeasureIndices].sort((a, b) => a - b)).toEqual(expectedVisible);
    expect(result.drawnMeasureIndices.size).toBeLessThan(score.tracks[0].measures.length);
  });

  it('records a bbox for every note event in the drawn window', () => {
    const score = twinkleScore();
    const renderer = new CanvasScoreRenderer();
    const result = renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
    });
    for (const note of allNotes(score)) {
      const box = result.idToBBox.get(note.id);
      expect(box).toBeDefined();
      expect(box!.width).toBeGreaterThan(0);
    }
  });

  it('records a bbox for every drawn measure, from the layout plan', () => {
    const score = twinkleScore();
    const renderer = new CanvasScoreRenderer();
    const result = renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
    });
    for (const measure of score.tracks[0].measures) {
      expect(result.measureIdToBBox.get(measure.id)).toBeDefined();
    }
  });

  it('per-frame draw work is O(visible): equal op counts for 1k vs 8k measures at the same viewport', () => {
    const renderer = new CanvasScoreRenderer();
    const small = createMock2DContext();
    renderer.render(stressScore(1, 1000), small, OPTS);
    const big = createMock2DContext();
    renderer.render(stressScore(1, 8000), big, OPTS);
    expect(big.ops.length).toBe(small.ops.length);
  }, 60_000);

  it('reuses the cached layout when only the viewport changes', () => {
    const score = twinkleScore();
    const renderer = new CanvasScoreRenderer();
    const a = renderer.render(score, createMock2DContext(), OPTS);
    const b = renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 100, bottom: 500 },
    });
    expect(b.plan).toBe(a.plan);
  });

  it('applies the dpr+zoom+scroll transform before drawing', () => {
    const ctx = createMock2DContext();
    new CanvasScoreRenderer().render(twinkleScore(), ctx, {
      ...OPTS,
      zoom: 2,
      devicePixelRatio: 2,
      viewport: { top: 50, bottom: 450 },
    });
    const transforms = ctx.ops.filter((o) => o.method === 'setTransform');
    // identity (for the clear) first, then the draw transform.
    expect(transforms[1]?.args).toEqual([4, 0, 0, 4, 0, -200]); // z*dpr = 4; offset = -top*z*dpr
  });
});
