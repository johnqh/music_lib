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
 * Zoom is applied once, uniformly, as a canvas transform scale in
 * `canvas-renderer.ts` (`ctx.setTransform(zoom·dpr, …)`) so glyphs/text
 * scale along with spacing instead of staying a fixed size while only the
 * layout stretches. The one place zoom enters this module is dividing the
 * *available* screen width by zoom to get the logical width budget for
 * page-mode wrapping (a more zoomed-in view fits fewer logical pixels in
 * the same screen width). Callers needing final on-screen coordinates
 * (e.g. `CanvasRenderResult` bboxes) must multiply this module's output by
 * `zoom` themselves.
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
  /** Top of the measure-number band; always `yTop - MEASURE_HEADER_HEIGHT`. */
  gutterTop: number;
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
/**
 * Heuristic per-event width budget for a measure's densest voice. A measure
 * whose densest voice packs more events than the base width comfortably
 * holds grows proportionally (`max(BASE, events * SLOT + PADDING)`), so
 * VexFlow never has to overflow the stave into the next measure's space —
 * which would break the shared-barline timeline across tracks. Density is
 * taken as the max over every track's voices at that measure index, so all
 * tracks agree on the (shared) measure width. Heuristic by design, like the
 * base width itself (spec §26).
 */
const NOTE_SLOT_WIDTH = 25;
/** Breathing room added to a density-derived measure width (start padding + last note's stem/flag overhang + barline clearance). */
const DENSE_MEASURE_PADDING = 35;
/** Extra width reserved on a system's first measure for clef + key signature + time signature. */
const SYSTEM_HEADER_WIDTH = 90;
const STAVE_HEIGHT = 100;
const TRACK_GAP = 20;
const SYSTEM_GAP = 40;
const LEFT_MARGIN = 10;

/**
 * Width reserved at the left of every system for the track-info gutter (track
 * name, instrument, mute/solo), and the width the app's track editing panel
 * matches.
 *
 * Reserving it here is what makes the gutter's alignment with the staves
 * structural: it lives in the same coordinate space, so there is nothing to
 * synchronise. The previous approach positioned a DOM list against reported
 * geometry and had to be stopped from scrolling independently.
 */
export const TRACK_INFO_WIDTH = 220;
const TOP_MARGIN = 10;

/**
 * Height of the measure-number band above each system's top stave (also the
 * click target for measure selection).
 *
 * Systems after the first take it out of `SYSTEM_GAP`, so nothing reflows.
 * The first system has only `TOP_MARGIN` above it — not enough — so the
 * effective top margin is raised by this much, which is why `totalHeight`
 * grows by twice this value (the margin is counted at both ends).
 */
export const MEASURE_HEADER_HEIGHT = 18;

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

  const headerWidth = SYSTEM_HEADER_WIDTH;
  const staveHeight = STAVE_HEIGHT;
  const trackGap = TRACK_GAP;
  const systemGap = SYSTEM_GAP;
  const leftMargin = LEFT_MARGIN + TRACK_INFO_WIDTH;
  // Trailing margin is the plain page margin, NOT `leftMargin`: that one
  // carries the track-info gutter's reserved column, and mirroring it on the
  // right padded every page-mode layout with a phantom TRACK_INFO_WIDTH of
  // empty space — enough to push `totalWidth` past the viewport and give page
  // mode a horizontal scrollbar it should never have had.
  const rightMargin = LEFT_MARGIN;
  const topMargin = TOP_MARGIN + MEASURE_HEADER_HEIGHT;

  // Density-aware per-measure widths (see NOTE_SLOT_WIDTH's doc): one shared
  // width per measure index across every track, from the densest voice.
  const contentWidths: number[] = Array.from({ length: measureCount }, (_, measureIndex) => {
    let maxEvents = 0;
    for (const track of tracks) {
      const measure = track.measures[measureIndex];
      if (!measure) continue;
      for (const voice of measure.voices) {
        maxEvents = Math.max(maxEvents, voice.events.length);
      }
    }
    return Math.max(BASE_MEASURE_WIDTH, maxEvents * NOTE_SLOT_WIDTH + DENSE_MEASURE_PADDING);
  });

  const widthOf = (measureIndex: number, isFirstInSystem: boolean): number =>
    (contentWidths[measureIndex] ?? BASE_MEASURE_WIDTH) + (isFirstInSystem ? headerWidth : 0);

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
    options.layoutMode === 'continuous'
      ? Number.POSITIVE_INFINITY
      : Math.max(options.width / zoom, leftMargin + rightMargin + BASE_MEASURE_WIDTH + headerWidth);
  // Both margins come out of the budget, so a packed system's right edge lands
  // at or inside `logicalAvailableWidth` and page mode's `totalWidth` below can
  // be exactly the viewport. The floor above is what one measure needs *with*
  // its margins, so this can never go negative.
  const systemsOfIndices = groupIntoSystems(
    measureCount,
    (i) => widthOf(i, true),
    logicalAvailableWidth - leftMargin - rightMargin,
  );

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
      const width = widthOf(measureIndex, isFirstInSystem);

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
    systems.push({
      measureIndices,
      xLeft: leftMargin,
      xRight: cursorX,
      gutterTop: yTop - MEASURE_HEADER_HEIGHT,
      yTop,
      yBottom,
    });
  });

  const totalHeight = systems.length > 0 ? systems[systems.length - 1].yBottom + topMargin : topMargin * 2;
  // Both terms are logical units here: `maxSystemRight` is logical by
  // construction, and `options.width` (a screen-pixel budget) is divided by
  // zoom to match, same as `logicalAvailableWidth` above.
  const totalWidth = Math.max(maxSystemRight + rightMargin, options.layoutMode === 'page' ? options.width / zoom : 0);

  return { tracks, trackLayouts, systems, totalWidth, totalHeight };
}

/**
 * The stave box for `measureIndex` on `plan.trackLayouts[trackIndex]`
 * (logical units), or `null` if that track/measure index isn't present in
 * the plan. Lets a caller locate a measure's position (e.g. to scroll to
 * it during playback) directly from layout, independent of whether that
 * measure fell inside the drawn window of a windowed canvas render pass
 * (system boxes never shift with what a given frame chooses to draw).
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
