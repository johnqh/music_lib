/**
 * Playhead caret geometry: maps a playback tick to a vertical-line position
 * on the notation canvas, and a canvas point back to a tick (click-to-seek).
 * Pure functions over `LayoutPlan` (logical/unscaled units — callers
 * multiply by zoom). Moved here from music_app's score-editor feature and
 * re-based on the binary-search lookups so every call is O(log n) — part of
 * the canvas renderer's "no O(score) interaction work" rule.
 *
 * The tick <-> x mapping interpolates linearly across each measure's stave
 * box. VexFlow doesn't space notes perfectly linearly (and first-in-system
 * measures spend their left edge on clef/key/time), so the caret is a close
 * approximation rather than glyph-exact — the same trade every DAW-style
 * ruler makes.
 */
import type { Score } from '@sudobility/music_types';
import { measureAtXInSystem, systemAtY } from './layout.js';
import type { LayoutPlan, SystemLayout } from './layout.js';

export type CaretPosition = {
  /** Logical x of the caret line. */
  x: number;
  /** Logical top/bottom of the system the tick falls in (the caret spans the whole system, all tracks). */
  yTop: number;
  yBottom: number;
};

type MeasureTiming = { startTick: number; durationTicks: number };

/** The score's shared measure grid (first track — every track shares it once `rebuildMeasureTicks` has run; same convention as `store/selectors.ts`). */
function measureTimings(score: Score): MeasureTiming[] {
  return score.tracks[0]?.measures ?? [];
}

/** Binary search over ascending `startTick`s for the measure containing `tick`; clamps below/above the score to the first/last measure. */
function measureIndexForTick(timings: MeasureTiming[], tick: number): number {
  if (tick < timings[0].startTick) return 0;
  let lo = 0;
  let hi = timings.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = timings[mid];
    if (tick < m.startTick) hi = mid - 1;
    else if (tick >= m.startTick + m.durationTicks) lo = mid + 1;
    else return mid;
  }
  return timings.length - 1;
}

/** Binary search over systems by their (ascending) measure-index ranges. */
function systemForMeasureIndex(
  plan: LayoutPlan,
  measureIndex: number
): SystemLayout | null {
  const systems = plan.systems;
  let lo = 0;
  let hi = systems.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = systems[mid];
    if (measureIndex < s.measureIndices[0]) hi = mid - 1;
    else if (measureIndex > s.measureIndices[s.measureIndices.length - 1])
      lo = mid + 1;
    else return s;
  }
  return null;
}

/**
 * Where the caret for `tick` sits on the canvas, or `null` when there is
 * nothing to draw against (empty score / no layout). Ticks past the end of
 * the score clamp to the final measure's right edge.
 */
export function caretPositionForTick(
  plan: LayoutPlan,
  score: Score,
  tick: number
): CaretPosition | null {
  const timings = measureTimings(score);
  if (timings.length === 0) return null;

  const measureIndex = measureIndexForTick(timings, tick);
  const timing = timings[measureIndex];
  const layout = plan.trackLayouts[0]?.measures[measureIndex];
  const system = systemForMeasureIndex(plan, measureIndex);
  if (!layout || !system) return null;

  const fraction =
    timing.durationTicks > 0
      ? Math.min(
          1,
          Math.max(0, (tick - timing.startTick) / timing.durationTicks)
        )
      : 0;
  return {
    x: layout.box.x + fraction * layout.box.width,
    yTop: system.yTop,
    yBottom: system.yBottom,
  };
}

/**
 * The tick a canvas click at logical `(x, y)` should seek to, or `null`
 * when the point is in dead space between/outside systems. Horizontal
 * positions left/right of a system's measures clamp to that system's
 * first/last measure, so clicking the clef area seeks to the system start.
 */
export function tickForPoint(
  plan: LayoutPlan,
  score: Score,
  x: number,
  y: number
): number | null {
  const timings = measureTimings(score);
  if (timings.length === 0) return null;

  const system = systemAtY(plan, y);
  if (!system) return null;

  const hit = measureAtXInSystem(plan, system, x);
  if (!hit) return null;
  const timing = timings[hit.measureIndex];
  if (!timing) return null;

  const fraction =
    hit.box.width > 0
      ? Math.min(1, Math.max(0, (x - hit.box.x) / hit.box.width))
      : 0;
  return Math.round(timing.startTick + fraction * timing.durationTicks);
}
