import { describe, expect, it, vi } from 'vitest';
import { Stave, StaveNote } from 'vexflow';
import { CanvasScoreRenderer } from './canvas-renderer.js';
import { TRACK_INFO_WIDTH, computeLayout } from './layout.js';
import type { RenderTheme } from './types.js';
import { createMock2DContext } from '../../test/canvas-stub.js';
import { denseVsSparseScore, stressScore, testRenderTheme, twinkleScore, twoTrackScore } from '../../test/fixtures.js';
import { allNotes } from '../../domain/score/queries.js';
import type { Score } from '@sudobility/music_types';

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
  type StyleCall = { fillStyle?: string; strokeStyle?: string; lineWidth?: number; shadowBlur?: number };
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

describe('measure-number gutter drawing', () => {
  it('draws a number for each measure in the drawn window', () => {
    const score = twinkleScore();
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();

    renderer.render(score, ctx, { ...OPTS, viewport: { top: 0, bottom: 10_000 } });

    const texts = ctx.ops.filter((o) => o.method === 'fillText').map((o) => String(o.args[0]));
    expect(texts).toContain('1');
    expect(texts).toContain('2');
  });

  it('numbers measures from 1, not 0', () => {
    const score = twinkleScore();
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();

    renderer.render(score, ctx, { ...OPTS, viewport: { top: 0, bottom: 10_000 } });

    const texts = ctx.ops.filter((o) => o.method === 'fillText').map((o) => String(o.args[0]));
    expect(texts).not.toContain('0');
  });

  it('tints the gutter cell of a selected measure', () => {
    const score = twinkleScore();
    const measureId = score.tracks[0].measures[0].id;
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();

    // fillStyle is a property write, so the mock's op log can't correlate it
    // with the fillRect that used it — capture it at call time instead.
    const fills: string[] = [];
    (ctx as unknown as { fillRect: () => void }).fillRect = function (this: { fillStyle: string }) {
      fills.push(this.fillStyle);
    };

    renderer.render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      selectedMeasureIds: new Set([measureId]),
    });

    expect(fills).toContain(THEME.noteSelected);
  });

  it('does not tint anything when no measure is selected', () => {
    const score = twinkleScore();
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();

    const fills: string[] = [];
    (ctx as unknown as { fillRect: () => void }).fillRect = function (this: { fillStyle: string }) {
      fills.push(this.fillStyle);
    };

    renderer.render(score, ctx, { ...OPTS, viewport: { top: 0, bottom: 10_000 } });

    expect(fills).not.toContain(THEME.noteSelected);
  });

  it('draws the gutter inside its own band, above the first stave', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, OPTS);
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();

    renderer.render(score, ctx, { ...OPTS, viewport: { top: 0, bottom: 10_000 } });

    // The score wraps across several systems, so each number must land in
    // *its own* system's band — not merely somewhere above the first stave.
    const numbers = ctx.ops
      .filter((o) => o.method === 'fillText' && /^\d+$/.test(String(o.args[0])))
      .map((o) => ({ text: String(o.args[0]), y: Number(o.args[2]) }));
    expect(numbers.length).toBeGreaterThan(0);

    const bands = plan.systems.map((s) => ({ top: s.gutterTop, bottom: s.yTop }));
    for (const { text, y } of numbers) {
      const inSomeBand = bands.some((b) => y >= b.top && y <= b.bottom);
      expect(inSomeBand, `measure ${text} drawn at y=${y}, outside every gutter band`).toBe(true);
    }
  });
});

describe('non-color state redundancy (spec §27)', () => {
  /** Records every `setStyle` call on StaveNote for one render. */
  function captureNoteStyles() {
    const calls: Array<{ lineWidth?: number; shadowBlur?: number; fillStyle?: string }> = [];
    const proto = StaveNote.prototype as { setStyle: (s: object) => unknown };
    const original = proto.setStyle;
    const spy = vi.spyOn(proto, 'setStyle').mockImplementation(function (this: unknown, style: object) {
      calls.push(style);
      return original.call(this, style);
    });
    return { calls, restore: () => spy.mockRestore() };
  }

  it('emphasises a selected note without relying on its color', () => {
    const score = twinkleScore();
    const noteId = allNotes(score)[0].id;
    const renderer = new CanvasScoreRenderer();
    const { calls, restore } = captureNoteStyles();

    renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      noteColors: new Map([[noteId, 'selected' as const]]),
    });
    restore();

    const selected = calls.find((s) => s.fillStyle === THEME.noteSelected)!;
    const normal = calls.find((s) => s.fillStyle === THEME.noteNormal)!;
    expect(selected.lineWidth).toBeGreaterThan(normal.lineWidth!);
  });

  it('never sets a shadow, which would cost a rasterizer blur pass per note', () => {
    const score = twinkleScore();
    const noteId = allNotes(score)[0].id;
    const renderer = new CanvasScoreRenderer();
    const { calls, restore } = captureNoteStyles();

    renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      noteColors: new Map([[noteId, 'playing' as const]]),
    });
    restore();

    expect(calls.every((s) => s.shadowBlur === undefined)).toBe(true);
  });

  it('emphasises playing notes too, so playback is followable in grayscale', () => {
    const score = twinkleScore();
    const noteId = allNotes(score)[0].id;
    const renderer = new CanvasScoreRenderer();
    const { calls, restore } = captureNoteStyles();

    renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      noteColors: new Map([[noteId, 'playing' as const]]),
    });
    restore();

    const playing = calls.find((s) => s.fillStyle === THEME.notePlaying)!;
    expect(playing.lineWidth).toBeGreaterThan(1);
  });
});

describe('track-info gutter drawing', () => {
  /** Captures fillText calls plus the fillStyle in force at each one. */
  function captureText(ctx: ReturnType<typeof createMock2DContext>) {
    const calls: Array<{ text: string; x: number; y: number; style: unknown }> = [];
    (ctx as unknown as { fillText: (t: string, x: number, y: number) => void }).fillText =
      function (this: { fillStyle: unknown }, text, x, y) {
        calls.push({ text: String(text), x, y, style: this.fillStyle });
      };
    return calls;
  }

  it('draws the track name and instrument beside the stave', () => {
    const score = twoTrackScore();
    const ctx = createMock2DContext();
    const texts = captureText(ctx);

    new CanvasScoreRenderer().render(score, ctx, { ...OPTS, viewport: { top: 0, bottom: 10_000 } });

    const drawn = texts.map((t) => t.text);
    for (const track of score.tracks) {
      expect(drawn).toContain(track.name);
      expect(drawn).toContain(track.instrumentName);
    }
  });

  it('repeats the gutter for every visible system', () => {
    const score = stressScore(1, 40);
    const ctx = createMock2DContext();
    const texts = captureText(ctx);

    const result = new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
    });

    // One name per drawn system, which is what an engraved score does.
    const systems = result.plan.systems.length;
    expect(systems).toBeGreaterThan(1);
    expect(texts.filter((t) => t.text === score.tracks[0].name)).toHaveLength(systems);
  });

  it('marks a muted track M and a soloed track S', () => {
    const score = twoTrackScore();
    const muted = {
      ...score,
      tracks: [{ ...score.tracks[0], muted: true }, { ...score.tracks[1], solo: true }],
    };
    const ctx = createMock2DContext();
    const texts = captureText(ctx);

    new CanvasScoreRenderer().render(muted, ctx, { ...OPTS, viewport: { top: 0, bottom: 10_000 } });

    const drawn = texts.map((t) => t.text);
    expect(drawn).toContain('M');
    expect(drawn).toContain('S');
  });

  it('draws the active track name in the active color and others inactive', () => {
    const score = twoTrackScore();
    const ctx = createMock2DContext();
    const texts = captureText(ctx);

    new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      activeTrackId: score.tracks[1].id,
    });

    const active = texts.find((t) => t.text === score.tracks[1].name)!;
    const inactive = texts.find((t) => t.text === score.tracks[0].name)!;
    expect(active.style).toBe(THEME.staveActive);
    expect(inactive.style).toBe(THEME.staveInactive);
  });

  it('keeps the gutter at the viewport edge when scrolled horizontally', () => {
    // Continuous mode is one very wide system; a gutter drawn in content space
    // would slide out of view, which is the one thing a label column cannot do.
    const score = twinkleScore();
    const name = score.tracks[0].name;

    const unscrolled = createMock2DContext();
    const a = captureText(unscrolled);
    new CanvasScoreRenderer().render(score, unscrolled, {
      ...OPTS,
      layoutMode: 'continuous',
      viewport: { top: 0, bottom: 10_000, left: 0, right: 900 },
    });

    const scrolled = createMock2DContext();
    const b = captureText(scrolled);
    new CanvasScoreRenderer().render(score, scrolled, {
      ...OPTS,
      layoutMode: 'continuous',
      viewport: { top: 0, bottom: 10_000, left: 600, right: 1500 },
    });

    expect(b.find((t) => t.text === name)!.x).toBe(a.find((t) => t.text === name)!.x);
  });

  it('clears the gutter region rather than filling it with a colour', () => {
    // Clearing shows the surface behind the canvas, so the gutter's background
    // matches the sheet's by construction; a theme colour could drift from it.
    // It also occludes content that scrolled underneath.
    const score = twinkleScore();
    const ctx = createMock2DContext();

    new CanvasScoreRenderer().render(score, ctx, { ...OPTS, viewport: { top: 0, bottom: 10_000 } });

    const clears = ctx.ops.filter((o) => o.method === 'clearRect').map((o) => o.args[2]);
    expect(clears).toContain(TRACK_INFO_WIDTH);
  });

  it('strokes the instrument icon before the instrument name', () => {
    const score = twoTrackScore();
    const ctx = createMock2DContext();
    const texts = captureText(ctx);

    new CanvasScoreRenderer().render(score, ctx, { ...OPTS, viewport: { top: 0, bottom: 10_000 } });

    // The gutter draws last, so everything after its final clearRect is the
    // gutter's own drawing — which is where the icon has to be.
    const isGutterClear = (o: (typeof ctx.ops)[number]) =>
      o.method === 'clearRect' && o.args[2] === TRACK_INFO_WIDTH;
    const gutterStart = ctx.ops.length - 1 - [...ctx.ops].reverse().findIndex(isGutterClear);
    const gutterOps = ctx.ops.slice(gutterStart);

    const iconOrigin = gutterOps.find((o) => o.method === 'translate');
    const name = texts.find((t) => t.text === score.tracks[0].instrumentName);
    expect(iconOrigin, 'icon is placed with a translate').toBeDefined();
    expect(gutterOps.some((o) => o.method === 'stroke')).toBe(true);
    // Icon first, so it reads as a label for the text beside it.
    expect(iconOrigin!.args[0] as number).toBeLessThan(name!.x);
  });

  it('strokes the icon in the same colour as the track it labels', () => {
    // The whole reason the icons are line art rather than emoji: an emoji keeps
    // its own colours, so it stayed bright beside a dimmed inactive track name.
    const score = twoTrackScore();
    const ctx = createMock2DContext();
    const strokes: unknown[] = [];
    (ctx as unknown as { stroke: () => void }).stroke = function (this: { strokeStyle: unknown }) {
      strokes.push(this.strokeStyle);
    };

    new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      activeTrackId: score.tracks[1].id,
    });

    // The gutter draws last and the icon is its only stroke, so the final one
    // belongs to the last track — the active one here.
    expect(strokes.at(-1)).toBe(THEME.staveActive);
  });
});

describe('inactive-track dimming', () => {
  /** Captures setStyle calls on a VexFlow class, with the styles applied. */
  function captureNoteStyles() {
    const original = StaveNote.prototype.setStyle;
    const styles: Array<Record<string, unknown>> = [];
    StaveNote.prototype.setStyle = function (this: StaveNote, style: Record<string, unknown>) {
      styles.push(style);
      return original.call(this, style);
    } as typeof original;
    return { styles, restore: () => (StaveNote.prototype.setStyle = original) };
  }

  it('draws notes off the active track in the inactive colour', () => {
    const score = stressScore(2, 2);
    const { styles, restore } = captureNoteStyles();

    new CanvasScoreRenderer().render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      activeTrackId: score.tracks[0].id,
    });
    restore();

    const fills = styles.map((s) => s.fillStyle);
    expect(fills).toContain(THEME.noteNormal);
    expect(fills).toContain(THEME.noteInactive);
  });

  it('dims nothing when no track is active', () => {
    // Dimming is relative — with nothing to be relative to, every note in the
    // score going grey would just look washed out.
    const score = stressScore(2, 2);
    const { styles, restore } = captureNoteStyles();

    new CanvasScoreRenderer().render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
    });
    restore();

    expect(styles.length).toBeGreaterThan(0);
    expect(styles.map((s) => s.fillStyle)).not.toContain(THEME.noteInactive);
  });

  it("dims a stave's clef and time signature with the rest of its track", () => {
    // Those glyphs draw from the context rather than the stave's own style, so
    // they are the one part of a track that can be left behind at full strength.
    const score = stressScore(2, 2);
    const fills = new Set<unknown>();
    const ctx = new Proxy(createMock2DContext(), {
      set(target, prop, value) {
        if (prop === 'fillStyle') fills.add(value);
        return Reflect.set(target, prop, value);
      },
    });

    new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      activeTrackId: score.tracks[0].id,
    });

    expect([...fills]).toContain(THEME.noteInactive);
    expect([...fills]).toContain(THEME.foreground);
  });

  it('keeps a selected note its selected colour even off the active track', () => {
    const score = stressScore(2, 2);
    const offActive = allNotes(score).filter((n) => score.tracks[1].measures.some((m) =>
      m.voices.some((v) => v.events.some((e) => e.id === n.id)),
    ));
    expect(offActive.length).toBeGreaterThan(0);
    const { styles, restore } = captureNoteStyles();

    new CanvasScoreRenderer().render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      activeTrackId: score.tracks[0].id,
      noteColors: new Map([[offActive[0].id, 'selected' as const]]),
    });
    restore();

    expect(styles.map((s) => s.fillStyle)).toContain(THEME.noteSelected);
  });
});

describe('showTrackInfo', () => {
  /** Every string the renderer drew — the stub records each call into `ops`. */
  function drawnText(score: Score, showTrackInfo: boolean): string {
    const ctx = createMock2DContext();
    new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 5000 },
      showTrackInfo,
    });
    return ctx.ops
      .filter((op) => op.method === 'fillText')
      .map((op) => String(op.args[0]))
      .join(' ');
  }

  it('draws the track name by default', () => {
    const score = twoTrackScore();
    expect(drawnText(score, true)).toContain(score.tracks[0].name);
  });

  it('draws no track name when off', () => {
    // Mute and solo on paper would be the giveaway; the name is what proves
    // the whole gutter is gone.
    const score = twoTrackScore();
    expect(drawnText(score, false)).not.toContain(score.tracks[0].name);
  });

  it('still draws the music when the gutter is off', () => {
    // The gutter going away must not take the notes with it.
    const score = twoTrackScore();
    const ctx = createMock2DContext();
    const result = new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 5000 },
      showTrackInfo: false,
    });
    expect(result.idToBBox.size).toBeGreaterThan(0);
  });
});

describe('multi-measure rests', () => {
  /** twinkleScore with measure 1 standing in for a 24-bar rest. */
  function collapsedScore(): Score {
    const score = twinkleScore();
    return {
      ...score,
      tracks: score.tracks.map((t) => ({
        ...t,
        measures: t.measures.map((m, i) =>
          i === 1 ? { ...m, multiMeasureRestCount: 24, voices: [] } : m,
        ),
      })),
    };
  }

  /** Path operations recorded while drawing `score`. */
  function drawOps(score: Score): number {
    const ctx = createMock2DContext();
    new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 5000 },
    });
    return ctx.ops.filter((op) => op.method === 'bezierCurveTo' || op.method === 'lineTo').length;
  }

  it('draws the numeral, not just the rest bar', () => {
    // VexFlow renders the count as glyph outlines rather than text, so there
    // is no string to match. A two-digit count draws strictly more path
    // segments than a one-digit one — which is only true if the number is
    // being drawn at all.
    const withCount = (count: number): Score => {
      const score = twinkleScore();
      return {
        ...score,
        tracks: score.tracks.map((t) => ({
          ...t,
          measures: t.measures.map((m, i) =>
            i === 1 ? { ...m, multiMeasureRestCount: count, voices: [] } : m,
          ),
        })),
      };
    };

    expect(drawOps(withCount(24))).toBeGreaterThan(drawOps(withCount(2)));
  });


  it('still gives the collapsed measure a box to sit in', () => {
    const ctx = createMock2DContext();
    const score = collapsedScore();
    const result = new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 5000 },
    });
    expect(result.measureIdToBBox.has(score.tracks[0].measures[1].id)).toBe(true);
  });

  it('still draws the ordinary measures around it', () => {
    const ctx = createMock2DContext();
    const result = new CanvasScoreRenderer().render(collapsedScore(), ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 5000 },
    });
    expect(result.idToBBox.size).toBeGreaterThan(0);
  });
});

describe('rehearsal marks', () => {
  /** Text drawn while rendering `score`, and how many boxes were stroked. */
  function drawn(score: Score): { texts: string[]; rects: number } {
    const ctx = createMock2DContext();
    new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 5000 },
    });
    return {
      texts: ctx.ops.filter((op) => op.method === 'fillText').map((op) => String(op.args[0])),
      rects: ctx.ops.filter((op) => op.method === 'rect').length,
    };
  }

  /** `score` with `label` on its second measure, in every track. */
  function withMark(score: Score, label: string): Score {
    return {
      ...score,
      tracks: score.tracks.map((t) => ({
        ...t,
        measures: t.measures.map((m, i) => (i === 1 ? { ...m, rehearsalMark: label } : m)),
      })),
    };
  }

  it('draws the letter itself', () => {
    // VexFlow puts the label through fillText rather than glyph outlines, so
    // the actual letter is assertable — much stronger than counting ink.
    const score = twinkleScore();
    expect(drawn(score).texts).not.toContain('B');
    expect(drawn(withMark(score, 'B')).texts).toContain('B');
  });

  it('draws a doubled letter whole', () => {
    // "AA", not "A" twice or "A" truncated.
    const marked = drawn(withMark(twinkleScore(), 'AA'));
    expect(marked.texts.filter((t) => t === 'AA')).toHaveLength(1);
  });

  it('boxes it', () => {
    // A bare letter beside a dynamic or a tempo marking is easy to miss.
    const score = twinkleScore();
    expect(drawn(withMark(score, 'B')).rects).toBe(drawn(score).rects + 1);
  });

  it('still draws the letter on a bar that is a multi-measure rest', () => {
    // The bar a lost player is most likely hunting for. `setSection` runs
    // before the collapsed-measure early return for exactly this reason.
    const score = twinkleScore();
    const restWithMark: Score = {
      ...score,
      tracks: score.tracks.map((t) => ({
        ...t,
        measures: t.measures.map((m, i) =>
          i === 1 ? { ...m, rehearsalMark: 'C', multiMeasureRestCount: 8, voices: [] } : m,
        ),
      })),
    };
    expect(drawn(restWithMark).texts).toContain('C');
  });
});

describe('cue labels', () => {
  it('draws the instrument name above the cue', () => {
    // Like a rehearsal mark, the label goes through fillText — so the actual
    // string is assertable rather than counting ink.
    const score = twinkleScore();
    const cued: Score = {
      ...score,
      tracks: score.tracks.map((t) => ({
        ...t,
        measures: t.measures.map((m, i) =>
          i === 1 ? { ...m, cue: { label: 'Flute', events: m.voices[0]?.events ?? [] } } : m,
        ),
      })),
    };
    const ctx = createMock2DContext();
    new CanvasScoreRenderer().render(cued, ctx, { ...OPTS, viewport: { top: 0, bottom: 5000 } });
    const texts = ctx.ops.filter((op) => op.method === 'fillText').map((op) => String(op.args[0]));
    expect(texts).toContain('Flute');
  });
});
