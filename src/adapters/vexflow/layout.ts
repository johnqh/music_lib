/**
 * System layout (spec §7, §26): decides which measures share a system
 * ("row") and the box (x, y, width, height) each track's stave occupies
 * for every measure, for both "page" (wraps to `options.width`) and
 * "continuous" (everything in one system) layout modes.
 *
 * Heuristic by design (per spec §26, layout need only be "practical", not
 * exact): measure width is a fixed target, not derived from actual note
 * density/glyph widths. Good enough for MVP rendering; a denser formatter
 * could replace this later without touching the renderer's shape.
 *
 * Units are LOGICAL (design-time) pixels, independent of `options.zoom`.
 * Zoom is applied once, uniformly, as an SVG viewBox scale in `renderer.ts`
 * (`context.scale(zoom, zoom)`) so glyphs/text scale along with spacing
 * instead of staying a fixed size while only the layout stretches. The one
 * place zoom enters this module is dividing the *available* screen width by
 * zoom to get the logical width budget for page-mode wrapping (a more
 * zoomed-in view fits fewer logical pixels in the same screen width).
 * Callers needing final on-screen coordinates (e.g. `RenderResult` bboxes)
 * must multiply this module's output by `zoom` themselves.
 */
import type { Score, Track } from '@sudobility/music_types';
import type { RenderOptions } from './types.js';

export type StaveBox = { x: number; y: number; width: number; height: number };

export type MeasureLayout = {
  measureIndex: number;
  isFirstInSystem: boolean;
  box: StaveBox;
};

export type TrackLayout = {
  track: Track;
  measures: MeasureLayout[];
};

/** A brace/connector-worthy row: the outer bounds of every track's stave sharing this system. */
export type SystemLayout = {
  measureIndices: number[];
  xLeft: number;
  xRight: number;
  yTop: number;
  yBottom: number;
};

export type LayoutPlan = {
  tracks: Track[];
  trackLayouts: TrackLayout[];
  systems: SystemLayout[];
  /** Logical (unscaled) units — multiply by zoom for the final on-screen SVG canvas size. */
  totalWidth: number;
  /** Logical (unscaled) units — multiply by zoom for the final on-screen SVG canvas size. */
  totalHeight: number;
};

const BASE_MEASURE_WIDTH = 200;
/** Extra width reserved on a system's first measure for clef + key signature + time signature. */
const SYSTEM_HEADER_WIDTH = 90;
const STAVE_HEIGHT = 100;
const TRACK_GAP = 20;
const SYSTEM_GAP = 40;
const LEFT_MARGIN = 10;
const TOP_MARGIN = 10;

/** Guards against a zero/negative/non-finite zoom breaking division or `context.scale`. */
export function resolveZoom(zoom: number): number {
  return zoom > 0 ? zoom : 1;
}

/** Tracks to render, in `options.trackIds` order when given (unknown ids are dropped); else score order. */
function selectTracks(score: Score, options: RenderOptions): Track[] {
  if (!options.trackIds || options.trackIds.length === 0) {
    return score.tracks;
  }
  const byId = new Map(score.tracks.map((t) => [t.id, t] as const));
  return options.trackIds.map((id) => byId.get(id)).filter((t): t is Track => t !== undefined);
}

/** Greedily groups measure indices into systems (rows) so each row's total width fits `maxWidth`. */
function groupIntoSystems(measureCount: number, measureWidth: (index: number) => number, maxWidth: number): number[][] {
  const systems: number[][] = [];
  let current: number[] = [];
  let currentWidth = 0;

  for (let i = 0; i < measureCount; i += 1) {
    const width = measureWidth(i);
    if (current.length > 0 && currentWidth + width > maxWidth) {
      systems.push(current);
      current = [];
      currentWidth = 0;
    }
    current.push(i);
    currentWidth += width;
  }
  if (current.length > 0) systems.push(current);
  return systems;
}

/**
 * Computes per-track, per-measure stave boxes and per-system outer bounds
 * (for brace/connector drawing), all in LOGICAL (unscaled) units — see the
 * module doc. Assumes all selected tracks share the same measure count; a
 * track with fewer measures than the score's max simply has no box for the
 * missing trailing measures (defensive, not expected in practice — spec §4
 * keeps tracks aligned to the same measure grid).
 */
export function computeLayout(score: Score, options: RenderOptions): LayoutPlan {
  const zoom = resolveZoom(options.zoom);
  const tracks = selectTracks(score, options);
  const measureCount = tracks.reduce((max, t) => Math.max(max, t.measures.length), 0);

  const measureWidth = BASE_MEASURE_WIDTH;
  const headerWidth = SYSTEM_HEADER_WIDTH;
  const staveHeight = STAVE_HEIGHT;
  const trackGap = TRACK_GAP;
  const systemGap = SYSTEM_GAP;
  const leftMargin = LEFT_MARGIN;
  const topMargin = TOP_MARGIN;

  const widthOf = (isFirstInSystem: boolean): number => measureWidth + (isFirstInSystem ? headerWidth : 0);

  // `options.width` is a screen-pixel budget; convert to the equivalent
  // logical-unit budget by dividing out zoom (a more zoomed-in view fits
  // fewer logical pixels in the same screen width) before packing systems.
  //
  // A measure's width can't depend on system membership until we know system
  // membership, so pack using each measure's "first-in-system" width as an
  // upper bound (every measure could end up first); this only ever
  // under-packs a system slightly versus a hypothetical perfect packer, never
  // overflows the logical width budget.
  const logicalAvailableWidth =
    options.layoutMode === 'continuous' ? Number.POSITIVE_INFINITY : Math.max(options.width / zoom, measureWidth + headerWidth);
  const systemsOfIndices = groupIntoSystems(measureCount, () => widthOf(true), logicalAvailableWidth - leftMargin);

  const rowHeight = (count: number): number => (count > 0 ? count * staveHeight + Math.max(0, count - 1) * trackGap : 0);
  const trackRowHeight = rowHeight(tracks.length);

  const trackLayouts: TrackLayout[] = tracks.map((track) => ({ track, measures: [] }));
  const systems: SystemLayout[] = [];

  let maxSystemRight = 0;

  systemsOfIndices.forEach((measureIndices, systemIndex) => {
    const yTop = topMargin + systemIndex * (trackRowHeight + systemGap);
    const yBottom = yTop + trackRowHeight;

    let cursorX = leftMargin;
    measureIndices.forEach((measureIndex, positionInSystem) => {
      const isFirstInSystem = positionInSystem === 0;
      const width = widthOf(isFirstInSystem);

      tracks.forEach((track, trackIndex) => {
        if (measureIndex >= track.measures.length) return;
        const y = yTop + trackIndex * (staveHeight + trackGap);
        trackLayouts[trackIndex].measures.push({
          measureIndex,
          isFirstInSystem,
          box: { x: cursorX, y, width, height: staveHeight },
        });
      });

      cursorX += width;
    });

    maxSystemRight = Math.max(maxSystemRight, cursorX);
    systems.push({ measureIndices, xLeft: leftMargin, xRight: cursorX, yTop, yBottom });
  });

  const totalHeight = systems.length > 0 ? systems[systems.length - 1].yBottom + topMargin : topMargin * 2;
  // Both terms are logical units here: `maxSystemRight` is logical by
  // construction, and `options.width` (a screen-pixel budget) is divided by
  // zoom to match, same as `logicalAvailableWidth` above.
  const totalWidth = Math.max(maxSystemRight + leftMargin, options.layoutMode === 'page' ? options.width / zoom : 0);

  return { tracks, trackLayouts, systems, totalWidth, totalHeight };
}

// ---- virtualization (Task 17, spec §26/§29) --------------------------------

/** A vertical scroll range, in the same LOGICAL (unscaled) units as `LayoutPlan` — see the module doc. */
export type Viewport = { top: number; bottom: number };

/**
 * Every measure index belonging to a system whose vertical span
 * (`[yTop, yBottom]`) intersects `viewport` (expanded by `overscan` on both
 * sides, e.g. one extra system's worth of buffer so scrolling doesn't flash
 * blank staves before the next render pass catches up).
 *
 * Deliberately a pure function of an already-computed `LayoutPlan`, not
 * something `computeLayout` itself does: culling only decides which
 * *already-positioned* measures actually get drawn (spec §26: "Render only
 * visible systems where practical"; §29: virtualization for long scores) —
 * every system keeps the same box regardless of what a given render pass
 * chooses to draw, so scroll geometry (and a not-yet-rendered measure's
 * position — see `boxForMeasureIndex`) never shifts as the visible window
 * changes. The caller (`ScoreEditorView`) is responsible for converting its
 * screen-pixel scroll viewport to these logical units (divide by zoom)
 * before calling this.
 */
export function visibleSystemMeasureIndices(plan: LayoutPlan, viewport: Viewport, overscan = 0): Set<number> {
  const top = viewport.top - overscan;
  const bottom = viewport.bottom + overscan;
  const indices = new Set<number>();
  for (const system of plan.systems) {
    if (system.yBottom < top || system.yTop > bottom) continue;
    for (const index of system.measureIndices) indices.add(index);
  }
  return indices;
}

/**
 * Whether `a` and `b` contain exactly the same measure indices (set
 * equality, order-independent). Used by `ScoreEditorView` to decide whether
 * a freshly-`visibleSystemMeasureIndices`-computed set actually differs
 * from the currently-applied one before committing a state update — a
 * scroll that stays within the same visible system(s) (plus overscan)
 * should never trigger a re-render, only a scroll that actually crosses
 * into/out of a system should (spec §29: virtualization shouldn't itself
 * become a per-scroll-frame performance cost).
 */
export function sameMeasureIndices(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const index of a) {
    if (!b.has(index)) return false;
  }
  return true;
}

/**
 * The stave box for `measureIndex` on `plan.trackLayouts[trackIndex]`
 * (logical units), or `null` if that track/measure index isn't present in
 * the plan. Lets a caller locate a measure's position (e.g. to scroll to
 * it during playback) directly from layout, independent of whether that
 * measure was actually drawn by a culled render pass — see
 * `visibleSystemMeasureIndices`'s doc comment.
 */
export function boxForMeasureIndex(plan: LayoutPlan, trackIndex: number, measureIndex: number): StaveBox | null {
  const trackLayout = plan.trackLayouts[trackIndex];
  if (!trackLayout) return null;
  return trackLayout.measures.find((m) => m.measureIndex === measureIndex)?.box ?? null;
}

/** Binary search over the y-sorted `plan.systems` for the system containing logical `y`; `null` in inter-system gaps or outside the score. O(log n). */
export function systemAtY(plan: LayoutPlan, y: number): SystemLayout | null {
  const systems = plan.systems;
  let lo = 0;
  let hi = systems.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = systems[mid];
    if (y < s.yTop) hi = mid - 1;
    else if (y > s.yBottom) lo = mid + 1;
    else return s;
  }
  return null;
}

/**
 * Binary search over `system`'s x-sorted measures (first track's layouts)
 * for the measure containing logical `x`, clamping x into the system's
 * measure span (clicks left of the clef resolve to the first measure,
 * right of the last barline to the last). `null` only when the system
 * resolves to no measure layouts. O(log n).
 *
 * Indexing note: `computeLayout` pushes one `MeasureLayout` per measure in
 * ascending order for every track that has the measure, so for track 0
 * `trackLayouts[0].measures[i].measureIndex === i` — direct indexing by
 * `system.measureIndices` values is safe (and bounds-guarded here anyway).
 */
export function measureAtXInSystem(plan: LayoutPlan, system: SystemLayout, x: number): MeasureLayout | null {
  const measures = plan.trackLayouts[0]?.measures;
  if (!measures || system.measureIndices.length === 0) return null;
  const first = measures[system.measureIndices[0]];
  const last = measures[system.measureIndices[system.measureIndices.length - 1]];
  if (!first || !last) return null;
  const clamped = Math.min(Math.max(x, first.box.x), last.box.x + last.box.width - 1e-9);

  let lo = 0;
  let hi = system.measureIndices.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = measures[system.measureIndices[mid]];
    if (!m) return null;
    if (clamped < m.box.x) hi = mid - 1;
    else if (clamped >= m.box.x + m.box.width) lo = mid + 1;
    else return m;
  }
  return last;
}
