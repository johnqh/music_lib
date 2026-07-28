import { describe, expect, it, vi } from 'vitest';
import { Stave, StaveNote } from 'vexflow';
import { CanvasScoreRenderer } from './canvas-renderer.js';
import { computeLayout } from './layout.js';
import type { RenderTheme } from './types.js';
import { createMock2DContext } from '../../test/canvas-stub.js';
import { denseVsSparseScore, stressScore, testRenderTheme, twinkleScore } from '../../test/fixtures.js';
import { allNotes } from '../../domain/score/queries.js';

const THEME: RenderTheme = testRenderTheme();
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

describe('CanvasScoreRenderer: unbounded-scale regression', () => {
  it('windowed render time does not scale with score size (10k-measure stress)', () => {
    const renderer = new CanvasScoreRenderer();
    const big = stressScore(2, 10_000);
    const ctx = createMock2DContext();
    renderer.render(big, ctx, OPTS); // warm the layout cache (the one allowed O(n) pass)
    const t0 = performance.now();
    for (let i = 0; i < 20; i += 1) {
      renderer.render(big, ctx, { ...OPTS, viewport: { top: i * 100, bottom: i * 100 + 400 } });
    }
    const perFrame = (performance.now() - t0) / 20;
    // Generous CI budget; the point is catching an O(score) regression
    // (which lands in the hundreds of ms), not micro-benchmarking.
    expect(perFrame).toBeLessThan(100);
  }, 60_000);
});

describe('CanvasScoreRenderer: cross-track timeline sync', () => {
  it('keeps a dense track tick-aligned with, and inside the same barlines as, a sparse track', () => {
    const score = denseVsSparseScore(); // 16 sixteenths/measure over 1 whole/measure
    const result = new CanvasScoreRenderer().render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 1_000_000 },
    });

    for (let m = 0; m < score.tracks[0].measures.length; m += 1) {
      const denseMeasure = score.tracks[0].measures[m];
      const sparseMeasure = score.tracks[1].measures[m];

      // Simultaneous events (same startTick) share a tick context under the
      // joint per-measure formatter, so their x positions must agree (small
      // tolerance: notehead glyph widths differ between whole and sixteenth).
      const denseFirst = result.idToBBox.get(denseMeasure.voices[0].events[0].id)!;
      const sparseWhole = result.idToBBox.get(sparseMeasure.voices[0].events[0].id)!;
      expect(denseFirst).toBeDefined();
      expect(sparseWhole).toBeDefined();
      expect(Math.abs(denseFirst.x - sparseWhole.x)).toBeLessThanOrEqual(10);

      // Every dense note stays inside its own measure's stave box — dense
      // content must widen the measure (density-aware layout), never spill
      // past the barline into the next measure's space.
      const box = result.measureIdToBBox.get(denseMeasure.id)!;
      for (const event of denseMeasure.voices[0].events) {
        const b = result.idToBBox.get(event.id)!;
        expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
        expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
      }
    }
  });
});

describe('CanvasScoreRenderer: continuous-mode horizontal windowing', () => {
  const CONTINUOUS = { ...OPTS, layoutMode: 'continuous' as const };

  it('draws only the measures intersecting the horizontal viewport', () => {
    const score = stressScore(1, 200);
    const result = new CanvasScoreRenderer().render(score, createMock2DContext(), {
      ...CONTINUOUS,
      viewport: { top: 0, bottom: 400, left: 1000, right: 1900 },
    });
    const expected = result.plan.trackLayouts[0].measures
      .filter((m) => m.box.x + m.box.width >= 1000 && m.box.x <= 1900)
      .map((m) => m.measureIndex);
    expect(expected.length).toBeGreaterThan(0);
    expect([...result.drawnMeasureIndices].sort((a, b) => a - b)).toEqual(expected);
    expect(result.drawnMeasureIndices.size).toBeLessThan(200);
  });

  it('per-frame horizontal draw work is O(visible): equal op counts for 1k vs 8k measures', () => {
    const viewport = { top: 0, bottom: 400, left: 5000, right: 5900 };
    const renderer = new CanvasScoreRenderer();
    const small = createMock2DContext();
    renderer.render(stressScore(1, 1000), small, { ...CONTINUOUS, viewport });
    const big = createMock2DContext();
    renderer.render(stressScore(1, 8000), big, { ...CONTINUOUS, viewport });
    expect(big.ops.length).toBe(small.ops.length);
  }, 60_000);

  it('applies the horizontal scroll offset in the draw transform', () => {
    const ctx = createMock2DContext();
    new CanvasScoreRenderer().render(twinkleScore(), ctx, {
      ...CONTINUOUS,
      viewport: { top: 0, bottom: 400, left: 300, right: 1200 },
    });
    const transforms = ctx.ops.filter((o) => o.method === 'setTransform');
    expect(transforms[1]?.args).toEqual([1, 0, 0, 1, -300, 0]);
  });

  it('omitted left/right draw the full horizontal extent (page-mode behavior unchanged)', () => {
    const score = twinkleScore();
    const renderer = new CanvasScoreRenderer();
    const result = renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
    });
    expect(result.drawnMeasureIndices.size).toBe(score.tracks[0].measures.length);
  });
});

describe('note and stave coloring', () => {
  /**
   * Records every `setStyle` call on a VexFlow class for one render, while
   * still delegating to the real implementation — the point is to observe
   * the colors, not to stub out styling.
   */
  type StyleCall = { fillStyle?: string; strokeStyle?: string };
  function captureStyles(cls: typeof Stave | typeof StaveNote) {
    const calls: StyleCall[] = [];
    const proto = cls.prototype as { setStyle: (style: StyleCall) => unknown };
    const original = proto.setStyle;
    const spy = vi.spyOn(proto, 'setStyle').mockImplementation(function (
      this: unknown,
      style: StyleCall,
    ) {
      calls.push(style);
      return original.call(this, style);
    });
    return { calls, restore: () => spy.mockRestore() };
  }

  it('styles a selected note with the selected color and leaves the rest normal', () => {
    const score = twinkleScore();
    const noteId = allNotes(score)[0].id;
    const renderer = new CanvasScoreRenderer();
    const { calls, restore } = captureStyles(StaveNote);

    renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      noteColors: new Map([[noteId, 'selected' as const]]),
    });
    restore();

    expect(calls.some((s) => s.fillStyle === THEME.noteSelected)).toBe(true);
    expect(calls.some((s) => s.fillStyle === THEME.noteNormal)).toBe(true);
  });

  it('colors every note normal when no map is supplied', () => {
    const score = twinkleScore();
    const renderer = new CanvasScoreRenderer();
    const { calls, restore } = captureStyles(StaveNote);

    renderer.render(score, createMock2DContext(), { ...OPTS, viewport: { top: 0, bottom: 10_000 } });
    restore();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((s) => s.fillStyle === THEME.noteNormal)).toBe(true);
  });

  it('sets stroke as well as fill, so stems and flags take the color too', () => {
    const score = twinkleScore();
    const noteId = allNotes(score)[0].id;
    const renderer = new CanvasScoreRenderer();
    const { calls, restore } = captureStyles(StaveNote);

    renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      noteColors: new Map([[noteId, 'playing' as const]]),
    });
    restore();

    expect(calls.some((s) => s.fillStyle === THEME.notePlaying && s.strokeStyle === THEME.notePlaying)).toBe(true);
  });

  it('styles the active track stave differently from the others', () => {
    const score = stressScore(2, 2);
    const renderer = new CanvasScoreRenderer();
    const { calls, restore } = captureStyles(Stave);

    renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      activeTrackId: score.tracks[1].id,
    });
    restore();

    const strokes = calls.map((s) => s.strokeStyle);
    expect(strokes).toContain(THEME.staveActive);
    expect(strokes).toContain(THEME.staveInactive);
  });

  it('marks every stave inactive when there is no active track', () => {
    const score = stressScore(2, 2);
    const renderer = new CanvasScoreRenderer();
    const { calls, restore } = captureStyles(Stave);

    renderer.render(score, createMock2DContext(), { ...OPTS, viewport: { top: 0, bottom: 10_000 } });
    restore();

    const strokes = calls.map((s) => s.strokeStyle);
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes).not.toContain(THEME.staveActive);
    expect(strokes.every((s) => s === THEME.staveInactive)).toBe(true);
  });
});
