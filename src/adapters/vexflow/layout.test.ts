import { describe, expect, it } from 'vitest';
import { boxForMeasureIndex, computeLayout, measureAtXInSystem, sameMeasureIndices, systemAtY, visibleSystemMeasureIndices } from './layout.js';
import type { RenderTheme } from './types.js';
import { chordScore, stressScore, twinkleScore, twoTrackScore } from '../../test/fixtures.js';

const theme: RenderTheme = { foreground: '#000', selection: '#00f', playback: '#f00', preview: '#999' };

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
    const plan = computeLayout(score, options({ width: 650 }));
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

describe('visibleSystemMeasureIndices (Task 17 virtualization)', () => {
  it('returns every measure index of a system whose span intersects the viewport, and none of an out-of-range system', () => {
    const score = twinkleScore(); // 8 measures
    const plan = computeLayout(score, options({ width: 300 })); // wraps into multiple systems
    expect(plan.systems.length).toBeGreaterThan(2);

    const firstSystem = plan.systems[0];
    const indices = visibleSystemMeasureIndices(plan, { top: firstSystem.yTop, bottom: firstSystem.yBottom });

    expect([...indices].sort((a, b) => a - b)).toEqual(firstSystem.measureIndices);
    // A system well past the viewport contributes nothing.
    const lastSystem = plan.systems[plan.systems.length - 1];
    for (const index of lastSystem.measureIndices) {
      if (!firstSystem.measureIndices.includes(index)) expect(indices.has(index)).toBe(false);
    }
  });

  it('expands the viewport by overscan on both sides', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, options({ width: 300 }));
    expect(plan.systems.length).toBeGreaterThan(1);

    const secondSystem = plan.systems[1];
    // A viewport that ends exactly where system 1 starts misses it without
    // overscan...
    const tight = visibleSystemMeasureIndices(plan, { top: 0, bottom: secondSystem.yTop - 1 });
    for (const index of secondSystem.measureIndices) expect(tight.has(index)).toBe(false);

    // ...but picks it up with enough overscan.
    const overscanned = visibleSystemMeasureIndices(
      plan,
      { top: 0, bottom: secondSystem.yTop - 1 },
      secondSystem.yBottom - secondSystem.yTop + 1,
    );
    for (const index of secondSystem.measureIndices) expect(overscanned.has(index)).toBe(true);
  });

  it('returns every measure index for a viewport spanning the whole plan', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, options());
    const indices = visibleSystemMeasureIndices(plan, { top: 0, bottom: plan.totalHeight });
    expect([...indices].sort((a, b) => a - b)).toEqual(score.tracks[0].measures.map((_, i) => i));
  });

  it('returns an empty set for an out-of-range viewport', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, options());
    expect(visibleSystemMeasureIndices(plan, { top: plan.totalHeight + 1000, bottom: plan.totalHeight + 2000 }).size).toBe(
      0,
    );
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

describe('sameMeasureIndices (Task 17 virtualization scroll-throttle guard)', () => {
  it('is true for two sets with the same members, regardless of insertion order', () => {
    expect(sameMeasureIndices(new Set([1, 2, 3]), new Set([3, 2, 1]))).toBe(true);
  });

  it('is true for the identical reference', () => {
    const s = new Set([1, 2]);
    expect(sameMeasureIndices(s, s)).toBe(true);
  });

  it('is false for sets of different size', () => {
    expect(sameMeasureIndices(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false);
  });

  it('is false for same-size sets with different members', () => {
    expect(sameMeasureIndices(new Set([1, 2, 3]), new Set([1, 2, 4]))).toBe(false);
  });

  it('is true for two empty sets', () => {
    expect(sameMeasureIndices(new Set(), new Set())).toBe(true);
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
