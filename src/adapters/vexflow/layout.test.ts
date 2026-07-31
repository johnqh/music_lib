import { describe, expect, it } from 'vitest';
import { MEASURE_HEADER_HEIGHT, TRACK_INFO_WIDTH, boxForMeasureIndex, computeLayout, measureAtXInSystem, systemAtY } from './layout.js';
import type { RenderTheme } from './types.js';
import { chordScore, denseVsSparseScore, stressScore, testRenderTheme, twinkleScore, twoTrackScore } from '../../test/fixtures.js';

const theme: RenderTheme = testRenderTheme();

function options(overrides: Partial<Parameters<typeof computeLayout>[1]> = {}) {
  return { zoom: 1, layoutMode: 'page' as const, width: 900, theme, ...overrides };
}

describe('computeLayout', () => {
  it('lays out every measure of every track, one box each', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, options());

    expect(plan.trackLayouts).toHaveLength(1);
    expect(plan.trackLayouts[0].measures).toHaveLength(score.tracks[0].measures.length);
    for (const m of plan.trackLayouts[0].measures) {
      expect(m.box.width).toBeGreaterThan(0);
      expect(m.box.height).toBeGreaterThan(0);
    }
  });

  it('wraps measures into multiple systems in page mode when they exceed the available width', () => {
    const score = twinkleScore(); // 8 measures
    const plan = computeLayout(score, options({ width: 300 }));
    expect(plan.systems.length).toBeGreaterThan(1);
    // Every measure is accounted for exactly once across systems.
    const allIndices = plan.systems.flatMap((s) => s.measureIndices);
    expect(allIndices).toEqual(score.tracks[0].measures.map((_, i) => i));
  });

  it('keeps every measure in a single system in continuous mode regardless of width', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, options({ layoutMode: 'continuous', width: 300 }));
    expect(plan.systems).toHaveLength(1);
    expect(plan.systems[0].measureIndices).toHaveLength(score.tracks[0].measures.length);
  });

  it('gives the first measure of each system extra width for clef/key/time', () => {
    const score = twinkleScore();
    // 650 + the gutter: the width budget has to leave room for a second
    // measure, or every measure is first-in-system and there is nothing to
    // compare against.
    const plan = computeLayout(score, options({ width: 650 + TRACK_INFO_WIDTH }));
    const measures = plan.trackLayouts[0].measures;
    const firstOfFirstSystem = measures.find((m) => m.isFirstInSystem);
    const nonFirst = measures.find((m) => !m.isFirstInSystem);
    expect(firstOfFirstSystem).toBeDefined();
    expect(nonFirst).toBeDefined();
    expect(firstOfFirstSystem!.box.width).toBeGreaterThan(nonFirst!.box.width);
  });

  it('stacks multiple tracks vertically within the same system', () => {
    const score = twoTrackScore();
    const plan = computeLayout(score, options());
    expect(plan.trackLayouts).toHaveLength(2);
    const trebleY = plan.trackLayouts[0].measures[0].box.y;
    const bassY = plan.trackLayouts[1].measures[0].box.y;
    expect(bassY).toBeGreaterThan(trebleY);
    // Same measure index shares x/width across tracks in the same system.
    expect(plan.trackLayouts[0].measures[0].box.x).toBe(plan.trackLayouts[1].measures[0].box.x);
    expect(plan.trackLayouts[0].measures[0].box.width).toBe(plan.trackLayouts[1].measures[0].box.width);
  });

  it('honors trackIds filtering and ordering', () => {
    const score = twoTrackScore();
    const [treble, bass] = score.tracks;
    const plan = computeLayout(score, options({ trackIds: [bass.id, treble.id] }));
    expect(plan.tracks.map((t) => t.id)).toEqual([bass.id, treble.id]);
  });

  it('keeps measure widths in fixed logical units, independent of zoom', () => {
    // Zoom is applied once, uniformly, as an SVG viewBox scale in
    // renderer.ts (finding: applying zoom to individual layout metrics
    // instead left glyphs a fixed size while only spacing grew/shrank).
    // Layout itself must therefore be zoom-invariant in logical units, at a
    // screen width generous enough that neither zoom level changes system
    // packing (so isFirstInSystem/header-width status can't confound the
    // comparison).
    const score = chordScore();
    const generousWidth = 5000;
    const small = computeLayout(score, options({ zoom: 0.5, width: generousWidth }));
    const large = computeLayout(score, options({ zoom: 2, width: generousWidth }));
    expect(small.systems).toHaveLength(1);
    expect(large.systems).toHaveLength(1);
    // The measure box itself is zoom-invariant in logical units. (totalWidth
    // is deliberately NOT compared here: it's floored at `options.width /
    // zoom` so the page fills the given screen width, which legitimately
    // differs in logical units between zoom levels — see computeLayout.)
    expect(large.trackLayouts[0].measures[1].box.width).toBe(small.trackLayouts[0].measures[1].box.width);
    expect(large.trackLayouts[0].measures[0].box.width).toBe(small.trackLayouts[0].measures[0].box.width);
  });

  it('divides the available screen width by zoom for page-mode wrapping, so a higher zoom fits fewer measures per system', () => {
    const score = twinkleScore(); // 8 measures
    const screenWidth = 900;
    const zoomedOut = computeLayout(score, options({ zoom: 0.5, width: screenWidth }));
    const zoomedIn = computeLayout(score, options({ zoom: 2, width: screenWidth }));
    expect(zoomedOut.systems[0].measureIndices.length).toBeGreaterThan(zoomedIn.systems[0].measureIndices.length);
  });

  it('produces a positive total width and height', () => {
    const score = chordScore();
    const plan = computeLayout(score, options());
    expect(plan.totalWidth).toBeGreaterThan(0);
    expect(plan.totalHeight).toBeGreaterThan(0);
  });
});

describe('boxForMeasureIndex (Task 17 virtualization)', () => {
  it('matches the box computeLayout already assigned that track/measure', () => {
    const score = twoTrackScore();
    const plan = computeLayout(score, options());
    expect(boxForMeasureIndex(plan, 0, 2)).toEqual(plan.trackLayouts[0].measures[2].box);
    expect(boxForMeasureIndex(plan, 1, 0)).toEqual(plan.trackLayouts[1].measures[0].box);
  });

  it('returns null for an out-of-range track index', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, options());
    expect(boxForMeasureIndex(plan, 5, 0)).toBeNull();
  });

  it('returns null for an out-of-range measure index', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, options());
    expect(boxForMeasureIndex(plan, 0, 9999)).toBeNull();
  });
});

describe('systemAtY / measureAtXInSystem', () => {
  const stressPlanScore = stressScore(1, 80);
  const stressPlan = computeLayout(stressPlanScore, options());

  it('finds the system containing a y inside it, for every system', () => {
    for (const system of stressPlan.systems) {
      expect(systemAtY(stressPlan, (system.yTop + system.yBottom) / 2)).toBe(system);
    }
  });

  it('returns null above the first system, below the last, and in inter-system gaps', () => {
    expect(systemAtY(stressPlan, stressPlan.systems[0].yTop - 1)).toBeNull();
    expect(systemAtY(stressPlan, stressPlan.systems.at(-1)!.yBottom + 1)).toBeNull();
    const gapY = (stressPlan.systems[0].yBottom + stressPlan.systems[1].yTop) / 2;
    expect(systemAtY(stressPlan, gapY)).toBeNull();
  });

  it('finds the measure containing an x, clamping outside the span', () => {
    const system = stressPlan.systems[1];
    const layouts = system.measureIndices.map(
      (i) => stressPlan.trackLayouts[0].measures.find((m) => m.measureIndex === i)!,
    );
    const target = layouts[1];
    expect(measureAtXInSystem(stressPlan, system, target.box.x + target.box.width / 2)).toBe(target);
    expect(measureAtXInSystem(stressPlan, system, -9999)!.measureIndex).toBe(layouts[0].measureIndex);
    expect(measureAtXInSystem(stressPlan, system, 99999)!.measureIndex).toBe(layouts.at(-1)!.measureIndex);
  });
});

describe('density-aware measure widths', () => {
  it('widens a dense measure past the base width, identically across tracks (shared barlines)', () => {
    const score = denseVsSparseScore(); // 16 sixteenths/measure vs 1 whole/measure
    const plan = computeLayout(score, options());
    for (let m = 0; m < score.tracks[0].measures.length; m += 1) {
      const dense = plan.trackLayouts[0].measures.find((l) => l.measureIndex === m)!;
      const sparse = plan.trackLayouts[1].measures.find((l) => l.measureIndex === m)!;
      expect(dense.box.width).toBe(sparse.box.width);
      expect(dense.box.x).toBe(sparse.box.x);
      expect(dense.box.width).toBeGreaterThan(200);
    }
  });

  it('keeps sparse scores at the base measure width (no shrink, no growth)', () => {
    const plan = computeLayout(twinkleScore(), options()); // <=4 events per measure
    const nonFirst = plan.trackLayouts[0].measures.filter((l) => !l.isFirstInSystem);
    expect(nonFirst.length).toBeGreaterThan(0);
    for (const layout of nonFirst) expect(layout.box.width).toBe(200);
  });
});

describe('measure-number gutter', () => {
  it('reserves a gutter band above every system', () => {
    const plan = computeLayout(stressScore(1, 40), options());
    expect(plan.systems.length).toBeGreaterThan(1);
    for (const system of plan.systems) {
      expect(system.gutterTop).toBe(system.yTop - MEASURE_HEADER_HEIGHT);
    }
  });

  it('keeps the first system gutter on screen', () => {
    const plan = computeLayout(twinkleScore(), options());
    expect(plan.systems[0].gutterTop).toBeGreaterThanOrEqual(0);
  });

  it('carves later gutters out of the existing system gap rather than overlapping the previous system', () => {
    const plan = computeLayout(stressScore(1, 40), options());
    for (let i = 1; i < plan.systems.length; i += 1) {
      expect(plan.systems[i].gutterTop).toBeGreaterThanOrEqual(plan.systems[i - 1].yBottom);
    }
  });

  it('leaves room for the gutter inside totalHeight', () => {
    const plan = computeLayout(twinkleScore(), options());
    expect(plan.totalHeight).toBeGreaterThanOrEqual(
      plan.systems[plan.systems.length - 1].yBottom + MEASURE_HEADER_HEIGHT,
    );
  });
});

describe('track-info gutter', () => {
  it('reserves TRACK_INFO_WIDTH at the left of every system', () => {
    const plan = computeLayout(twinkleScore(), options());
    for (const system of plan.systems) {
      expect(system.xLeft).toBeGreaterThanOrEqual(TRACK_INFO_WIDTH);
    }
  });

  it('shifts the first stave right by exactly the gutter width', () => {
    const plan = computeLayout(twinkleScore(), options());
    const firstBox = plan.trackLayouts[0].measures[0].box;
    // 10px LEFT_MARGIN was the origin before the gutter existed.
    expect(firstBox.x).toBe(10 + TRACK_INFO_WIDTH);
  });

  it('grows totalWidth to account for the gutter', () => {
    const plan = computeLayout(twinkleScore(), options());
    const lastMeasure = plan.trackLayouts[0].measures.at(-1)!;
    expect(plan.totalWidth).toBeGreaterThan(TRACK_INFO_WIDTH);
    expect(plan.totalWidth).toBeGreaterThanOrEqual(lastMeasure.box.x);
  });

  it('keeps every track\'s staves at the same x, so one gutter serves them all', () => {
    const plan = computeLayout(twoTrackScore(), options());
    const a = plan.trackLayouts[0].measures[0].box.x;
    const b = plan.trackLayouts[1].measures[0].box.x;
    expect(a).toBe(b);
  });
});

describe('page mode fits the viewport width', () => {
  // The track-info gutter's reserved column used to be mirrored as the trailing
  // margin, padding every page layout with a phantom TRACK_INFO_WIDTH and
  // giving page mode a horizontal scrollbar it should never have.
  for (const width of [640, 900, 1280, 1920]) {
    it(`never exceeds a ${width}px viewport`, () => {
      const plan = computeLayout(stressScore(3, 40), {
        zoom: 1,
        layoutMode: 'page',
        width,
        theme: testRenderTheme(),
      });
      expect(plan.totalWidth).toBeLessThanOrEqual(width);
      for (const system of plan.systems) expect(system.xRight).toBeLessThanOrEqual(width);
    });
  }

  it('fits the viewport at zoom, where the budget is width/zoom', () => {
    const width = 1280;
    for (const zoom of [0.75, 1, 1.5, 2]) {
      const plan = computeLayout(stressScore(2, 30), {
        zoom,
        layoutMode: 'page',
        width,
        theme: testRenderTheme(),
      });
      expect(plan.totalWidth * zoom).toBeLessThanOrEqual(width + 0.001);
    }
  });

  it('still lays continuous mode out past the viewport, which is the point of it', () => {
    const plan = computeLayout(stressScore(1, 40), {
      zoom: 1,
      layoutMode: 'continuous',
      width: 900,
      theme: testRenderTheme(),
    });
    expect(plan.totalWidth).toBeGreaterThan(900);
    expect(plan.systems).toHaveLength(1);
  });
});
