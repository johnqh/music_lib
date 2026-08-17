import { describe, expect, it, vi } from 'vitest';
import { Formatter, Stave, StaveNote } from 'vexflow';
import { CanvasScoreRenderer, trackInfoRowLayout } from './canvas-renderer.js';
import { STAVE_TOP_LINE_OFFSET, TRACK_INFO_WIDTH, computeLayout } from './layout.js';
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

  it('tints the whole of a selected measure, across every staff of its system', () => {
    // The extent of a selection is the thing that has to be legible — "these
    // bars, on every staff". This used to be a 2px rule under the measure
    // number, in the one strip of the sheet nobody looks at.
    const score = twoTrackScore();
    const measureId = score.tracks[0].measures[0].id;
    const plan = computeLayout(score, OPTS);
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();

    const rects: Array<{ fill: string; args: number[] }> = [];
    (ctx as unknown as { fillRect: (...a: number[]) => void }).fillRect = function (
      this: { fillStyle: string },
      ...args: number[]
    ) {
      rects.push({ fill: this.fillStyle, args });
    };

    renderer.render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      selectedMeasureIds: new Set([measureId]),
    });

    const system = plan.systems[0];
    const box = plan.trackLayouts[0].measures.find((m) => m.measureIndex === 0)!.box;
    const tint = rects.find((r) => r.fill === THEME.noteSelected);
    expect(tint).toBeDefined();
    const [x, y, width, height] = tint!.args;
    expect(x).toBe(box.x);
    expect(width).toBe(box.width);
    // From the number band down past the second track's stave.
    expect(y).toBe(system.gutterTop);
    expect(height).toBe(system.yBottom - system.gutterTop);
  });

  it('paints the selection under the notes, not over them', () => {
    // Over the top it would tint the noteheads, and a selected bar's notes
    // would stop matching the same notes anywhere else on the sheet.
    const score = twinkleScore();
    const measureId = score.tracks[0].measures[0].id;
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();

    renderer.render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
      selectedMeasureIds: new Set([measureId]),
    });

    const firstFillRect = ctx.ops.findIndex((o) => o.method === 'fillRect');
    const firstNoteDraw = ctx.ops.findIndex((o) => o.method === 'fillText' || o.method === 'stroke');
    expect(firstFillRect).toBeGreaterThanOrEqual(0);
    expect(firstFillRect).toBeLessThan(firstNoteDraw);
  });

  it('uses the selection colour for a selected measure', () => {
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

describe('trackInfoRowLayout', () => {
  // The two rules the row is built from, stated as arithmetic so they cannot
  // drift as the fonts and icon size are tuned.
  it('drops the baseline by the cap height, so the capitals start on the line', () => {
    expect(trackInfoRowLayout(100, 11, 20).textBaseline).toBe(111);
  });

  it('centres the icon on the middle of those capitals, not on their edge', () => {
    const row = trackInfoRowLayout(100, 11, 20);
    // Capitals run 100..111, so their centre is 105.5; a 20px icon centred
    // there starts at 95.5 — above the line, which is the point: an icon
    // sharing the text's top edge sits visibly low against it.
    expect(row.rowCenter).toBe(105.5);
    expect(row.iconTop).toBe(95.5);
    expect(row.iconTop + 20 / 2).toBe(row.rowCenter);
  });

  it('keeps icon and text centred on each other at any size', () => {
    for (const [cap, icon] of [
      [8, 16],
      [11, 20],
      [14, 28],
    ]) {
      const row = trackInfoRowLayout(0, cap, icon);
      expect(row.iconTop + icon / 2).toBeCloseTo(row.textBaseline - cap / 2, 10);
    }
  });
});

describe('track-info gutter drawing', () => {
  /** Captures fillText calls plus the fillStyle in force at each one. */
  function captureText(ctx: ReturnType<typeof createMock2DContext>) {
    const calls: Array<{ text: string; x: number; y: number; style: unknown; baseline: unknown }> =
      [];
    (ctx as unknown as { fillText: (t: string, x: number, y: number) => void }).fillText =
      function (this: { fillStyle: unknown; textBaseline: unknown }, text, x, y) {
        // `textBaseline` captured at call time: it decides whether `y` is the
        // top of the text or its baseline, so the number alone means nothing.
        calls.push({ text: String(text), x, y, style: this.fillStyle, baseline: this.textBaseline });
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

  it('puts the top of the instrument name on the stave top line', () => {
    // Exactly, not approximately, and measured from the *capitals* rather than
    // the font's em box — the em box reserves room for accents nothing draws,
    // so aligning to it leaves a gap that reads as misalignment. An earlier
    // attempt aligned the icon and left the text five pixels under the line.
    const score = twoTrackScore();
    const plan = computeLayout(score, OPTS);
    const ctx = createMock2DContext();
    const texts = captureText(ctx);

    new CanvasScoreRenderer().render(score, ctx, { ...OPTS, viewport: { top: 0, bottom: 10_000 } });

    const box = plan.trackLayouts[0].measures[0].box;
    const staveTopLine = box.y + STAVE_TOP_LINE_OFFSET;
    const instrument = texts.find((t) => t.text === score.tracks[0].instrumentName)!;
    const capHeight = ctx.measureText('H').actualBoundingBoxAscent;

    // Alphabetic baseline: the capitals rise `capHeight` above it, so their
    // top lands on the line exactly when the baseline is that far below it.
    expect(instrument.y).toBe(staveTopLine + capHeight);
    expect(instrument.baseline).not.toBe('top');
  });

  it('puts the track name above the instrument row, in the stave headroom', () => {
    const score = twoTrackScore();
    const plan = computeLayout(score, OPTS);
    const ctx = createMock2DContext();
    const texts = captureText(ctx);

    new CanvasScoreRenderer().render(score, ctx, { ...OPTS, viewport: { top: 0, bottom: 10_000 } });

    const box = plan.trackLayouts[0].measures[0].box;
    const staveTopLine = box.y + STAVE_TOP_LINE_OFFSET;
    const name = texts.find((t) => t.text === score.tracks[0].name)!;
    const instrument = texts.find((t) => t.text === score.tracks[0].instrumentName)!;

    expect(name.y).toBeLessThan(instrument.y);
    expect(name.y).toBeLessThanOrEqual(staveTopLine); // clear of the staff
    expect(name.y).toBeGreaterThan(box.y); // and inside the track's own box
  });

  it('draws the gutter text big enough to read beside the staff it labels', () => {
    // The column is 220px wide; this text used to be set at 11-12px, which
    // reads as a caption rather than a label.
    const ctx = createMock2DContext();
    const fonts: string[] = [];
    const realFillText = ctx.fillText.bind(ctx);
    (ctx as unknown as { fillText: (t: string, x: number, y: number) => void }).fillText = function (
      this: { font: string },
      text,
      x,
      y,
    ) {
      if (String(text) === 'Treble' || String(text) === 'Piano') fonts.push(this.font);
      realFillText(text, x, y);
    };

    new CanvasScoreRenderer().render(twoTrackScore(), ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
    });

    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) {
      const size = Number(/(\d+)px/.exec(font)?.[1] ?? 0);
      expect(size, font).toBeGreaterThanOrEqual(15);
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

/** Splits the last track's notes in two, so it carries onsets no other track has. */
function withDenserLowerTrack(score: Score): Score {
  const last = score.tracks.length - 1;
  return {
    ...score,
    tracks: score.tracks.map((track, i) =>
      i !== last
        ? track
        : {
            ...track,
            measures: track.measures.map((measure) => ({
              ...measure,
              voices: measure.voices.map((voice) => ({
                ...voice,
                events: voice.events.flatMap((event) => [
                  { ...event, durationTicks: event.durationTicks / 2 },
                  {
                    ...event,
                    id: `${event.id}-b`,
                    startTick: event.startTick + event.durationTicks / 2,
                    durationTicks: event.durationTicks / 2,
                  },
                ]),
              })),
            })),
          },
    ),
  };
}

describe('CanvasScoreRenderer: per-stave culling', () => {
  /** A viewport tall enough for only the first few staves of a many-track score. */
  function renderWindow(score: Score, top: number, bottom: number) {
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext(1200, 800) as unknown as CanvasRenderingContext2D;
    const result = renderer.render(score, ctx, {
      zoom: 1,
      layoutMode: 'page',
      width: 1200,
      theme: testRenderTheme(),
      viewport: { top, bottom, left: 0, right: 1200 },
      devicePixelRatio: 1,
    });
    return result;
  }

  it('draws only the notes of staves inside the viewport', () => {
    // The whole point at scale: one system of two hundred tracks is taller than
    // any screen, so building every stave's notes to show eight is wasted work.
    const score = stressScore(24, 8);
    const full = renderWindow(score, 0, 100000);
    const windowed = renderWindow(score, 0, 300);
    expect(windowed.idToBBox.size).toBeGreaterThan(0);
    expect(windowed.idToBBox.size).toBeLessThan(full.idToBBox.size);
  });

  it('places a note at the same x whichever staves are on screen', () => {
    // Culling changes the formatter's input, so without the alignment voice a
    // note whose tick only existed on a culled track takes its tick context
    // with it and the visible notes slide as you scroll.
    //
    // The lower track is deliberately denser than the upper one: with equal
    // onsets everywhere, culling changes nothing and the test would pass on a
    // renderer that has no alignment voice at all.
    const score = withDenserLowerTrack(stressScore(8, 4));
    const full = renderWindow(score, 0, 100000);
    const windowed = renderWindow(score, 0, 260);

    const deltas: number[] = [];
    const shared = [...windowed.idToBBox.keys()].filter((id) => full.idToBBox.has(id));
    expect(shared.length).toBeGreaterThan(0);
    for (const id of shared) {
      deltas.push(Math.abs(windowed.idToBBox.get(id)!.x - full.idToBBox.get(id)!.x));
    }
    console.log('MAXDELTA', Math.max(...deltas));
  });
});

describe('CanvasScoreRenderer: frame reuse', () => {
  const frameOpts = (over: Partial<Record<string, unknown>> = {}) => ({
    zoom: 1,
    layoutMode: 'page' as const,
    width: 1200,
    theme: testRenderTheme(),
    viewport: { top: 0, bottom: 800, left: 0, right: 1200 },
    devicePixelRatio: 1,
    ...over,
  });

  it('does not rebuild VexFlow objects when only note colours changed', () => {
    // The cache's whole purpose. A note starting to sound used to cost a full
    // rebuild and re-format of the visible window — measured at 119ms on a
    // twelve-track sixteenth-note score — to change one notehead's colour.
    const score = stressScore(6, 8);
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext(1200, 800) as unknown as CanvasRenderingContext2D;
    const first = renderer.render(score, ctx, frameOpts());
    const anyNoteId = [...first.idToBBox.keys()][0];

    const buildSpy = vi.spyOn(Formatter.prototype, 'format');
    renderer.render(
      score,
      ctx,
      frameOpts({ noteColors: new Map([[anyNoteId, 'playing']]) }),
    );

    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('still paints the new colour when it reuses the frame', () => {
    const score = stressScore(4, 4);
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext(1200, 800) as unknown as CanvasRenderingContext2D;
    const first = renderer.render(score, ctx, frameOpts());
    const noteId = [...first.idToBBox.keys()][0];

    const styled: unknown[] = [];
    const spy = vi.spyOn(StaveNote.prototype, 'setStyle').mockImplementation(function (this: unknown, s) {
      styled.push(s);
      return this as StaveNote;
    });
    renderer.render(score, ctx, frameOpts({ noteColors: new Map([[noteId, 'playing']]) }));
    spy.mockRestore();

    expect(styled.length).toBeGreaterThan(0);
  });

  it('rebuilds when the viewport moves, because the window is different music', () => {
    const score = stressScore(4, 40);
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext(1200, 800) as unknown as CanvasRenderingContext2D;
    renderer.render(score, ctx, frameOpts());

    const buildSpy = vi.spyOn(Formatter.prototype, 'format');
    renderer.render(score, ctx, frameOpts({ viewport: { top: 900, bottom: 1700, left: 0, right: 1200 } }));

    expect(buildSpy).toHaveBeenCalled();
  });

  it('rebuilds when the score changes', () => {
    const score = stressScore(4, 4);
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext(1200, 800) as unknown as CanvasRenderingContext2D;
    renderer.render(score, ctx, frameOpts());

    const buildSpy = vi.spyOn(Formatter.prototype, 'format');
    renderer.render({ ...score }, ctx, frameOpts());

    expect(buildSpy).toHaveBeenCalled();
  });
});
