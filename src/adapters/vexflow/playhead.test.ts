import { describe, expect, it } from 'vitest';
import { computeLayout } from './layout.js';
import { caretPositionForTick, tickForPoint } from './playhead.js';
import type { RenderTheme } from './types.js';
import { stressScore, testRenderTheme, twinkleScore } from '../../test/fixtures.js';

const theme: RenderTheme = testRenderTheme();

function plan(score = twinkleScore()) {
  return computeLayout(score, { zoom: 1, layoutMode: 'page', width: 900, theme });
}

describe('caretPositionForTick', () => {
  it('places tick 0 at the first measure left edge, spanning the first system', () => {
    const score = twinkleScore();
    const p = plan(score);
    const caret = caretPositionForTick(p, score, 0)!;
    const firstMeasure = p.trackLayouts[0].measures[0];
    expect(caret.x).toBe(firstMeasure.box.x);
    expect(caret.yTop).toBe(p.systems[0].yTop);
    expect(caret.yBottom).toBe(p.systems[0].yBottom);
  });

  it('interpolates linearly within a measure', () => {
    const score = twinkleScore();
    const p = plan(score);
    const m0 = score.tracks[0].measures[0];
    const halfway = m0.startTick + m0.durationTicks / 2;
    const caret = caretPositionForTick(p, score, halfway)!;
    const box = p.trackLayouts[0].measures[0].box;
    expect(caret.x).toBeCloseTo(box.x + box.width / 2, 5);
  });

  it('clamps ticks past the end of the score to the final measure right edge', () => {
    const score = twinkleScore();
    const p = plan(score);
    const caret = caretPositionForTick(p, score, Number.MAX_SAFE_INTEGER)!;
    const lastLayout = p.trackLayouts[0].measures.at(-1)!;
    expect(caret.x).toBe(lastLayout.box.x + lastLayout.box.width);
  });

  it('resolves every measure of a large score to its own system (binary search consistency)', () => {
    const score = stressScore(1, 200);
    const p = plan(score);
    for (const measure of score.tracks[0].measures) {
      const caret = caretPositionForTick(p, score, measure.startTick)!;
      const system = p.systems.find((s) =>
        s.measureIndices.includes(score.tracks[0].measures.indexOf(measure)),
      )!;
      expect(caret.yTop).toBe(system.yTop);
    }
  });
});

describe('tickForPoint', () => {
  it('round-trips with caretPositionForTick inside a measure', () => {
    const score = twinkleScore();
    const p = plan(score);
    const m1 = score.tracks[0].measures[1];
    const targetTick = m1.startTick + Math.round(m1.durationTicks / 4);
    const caret = caretPositionForTick(p, score, targetTick)!;
    const tick = tickForPoint(p, score, caret.x, (caret.yTop + caret.yBottom) / 2);
    expect(tick).toBe(targetTick);
  });

  it('clamps clicks left of the first measure (clef area) to the system start tick', () => {
    const score = twinkleScore();
    const p = plan(score);
    const system = p.systems[0];
    const tick = tickForPoint(p, score, 0, (system.yTop + system.yBottom) / 2);
    const firstIndex = Math.min(...system.measureIndices);
    expect(tick).toBe(score.tracks[0].measures[firstIndex].startTick);
  });

  it('returns null in the dead space between systems', () => {
    const score = stressScore(1, 80);
    const p = plan(score);
    const gapY = (p.systems[0].yBottom + p.systems[1].yTop) / 2;
    expect(tickForPoint(p, score, 100, gapY)).toBeNull();
  });
});
