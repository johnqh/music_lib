/**
 * System layout (spec §7, §26): decides which measures share a system
 * ("row") and the box (x, y, width, height) each track's stave occupies
 * for every measure, for both "page" (wraps to `options.width`) and
 * "continuous" (everything in one system) layout modes.
 *
 * Measure width is derived from how many onsets a bar actually draws, times a
 * per-onset budget measured from VexFlow's own minimum — close enough that a
 * dense bar is neither cramped nor half empty, without laying every glyph out
 * twice to find out exactly.
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
import { snappedOnsetTicks } from './display-timing.js';
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

export const BASE_MEASURE_WIDTH = 160;

/**
 * Width of a measure standing in for a run of silent ones.
 *
 * Fixed rather than proportional to the count: a 60-bar rest should not be
 * thirty times wider than a 2-bar one. It only has to fit the horizontal bar
 * and a numeral.
 */
const MULTI_REST_MEASURE_WIDTH = 320;
/**
 * Width budget per drawn onset.
 *
 * Measured, not guessed: `Formatter.preCalculateMinTotalWidth` asks 446 units
 * for a bar of sixteen sixteenths, which is 27.9 each, and the same 27.9
 * whether or not every one of them carries an accidental. Rounded up to 28, so
 * a dense bar is given at least what VexFlow will ask for and never has to
 * overflow into the next measure's space — which would break the shared
 * barline across tracks.
 *
 * A measure with more onsets than the base width comfortably holds grows
 * proportionally (`max(BASE, onsets * SLOT + PADDING)`), and the count is the
 * union across every track, so all tracks agree on the shared width.
 */
export const NOTE_SLOT_WIDTH = 28;
/** Breathing room added to a density-derived measure width (start padding + last note's stem/flag overhang + barline clearance). */
export const DENSE_MEASURE_PADDING = 35;
/** Extra width reserved on a system's first measure for clef + key signature + time signature. */
export const SYSTEM_HEADER_WIDTH = 90;
/**
 * The least room the music is ever given, whatever the window does.
 *
 * Only a guard against a zero or negative budget once the gutter and margins
 * are taken out of a very narrow viewport. Music this cramped is unreadable,
 * but it is *there* — better than the right-hand part of every bar being
 * silently clipped away, which is what a larger floor used to cause.
 */
const MIN_CONTENT_WIDTH = 80;
const STAVE_HEIGHT = 100;

/**
 * Vertical distance between adjacent staff positions, in logical units — one
 * line to the space beside it.
 *
 * VexFlow spaces its five lines 10 units apart and the renderer does not
 * override that, so a staff position is half of it. Exported because dragging a
 * note up and down the staff needs to turn pixels into positions, and deriving
 * that from `STAVE_HEIGHT` would be wrong: that is the whole row a track is
 * given, padding included, not the ruled staff.
 */
export const STAVE_POSITION_HEIGHT = 5;
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

/**
 * Greedily groups measure indices into systems (rows) so each row's total width
 * fits `maxWidth`.
 *
 * `measureWidth` is asked for the width a measure would have *in the position
 * being considered*, because only the first measure of a system carries the
 * clef, key and time signature. Packing used to assume every measure might be
 * that one and add the header to all of them — an upper bound that never
 * overflowed but routinely left a system a bar short of what it could hold.
 */
function groupIntoSystems(
  measureCount: number,
  measureWidth: (index: number, isFirstInSystem: boolean) => number,
  maxWidth: number,
): number[][] {
  const systems: number[][] = [];
  let current: number[] = [];
  let currentWidth = 0;

  for (let i = 0; i < measureCount; i += 1) {
    const width = measureWidth(i, current.length === 0);
    if (current.length > 0 && currentWidth + width > maxWidth) {
      systems.push(current);
      current = [];
      currentWidth = measureWidth(i, true);
    } else {
      currentWidth += width;
    }
    current.push(i);
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
  // The gutter's reserved column is part of the left margin, so turning the
  // gutter off has to shrink the margin too — otherwise the space stays blank
  // and the music is simply indented for no reason.
  const showTrackInfo = options.showTrackInfo ?? true;
  const leftMargin = LEFT_MARGIN + (showTrackInfo ? TRACK_INFO_WIDTH : 0);
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
    // Count the distinct onsets the measure will actually draw, across every
    // track — that is one tick context each, and VexFlow's minimum width is
    // proportional to how many there are.
    //
    // Not `voice.events.length`: recorded events and drawn tickables are not
    // the same thing. A drum bar of 37 hits three ticks apart draws as 16 once
    // they are chorded, and giving it width for 37 left it half empty and
    // pushed every other bar onto its own line.
    const onsets = new Set<number>();
    for (const track of tracks) {
      const measure = track.measures[measureIndex];
      if (!measure) continue;
      for (const voice of measure.voices) {
        for (const tick of snappedOnsetTicks(voice.events, measure.startTick, measure.durationTicks, score.ppq)) {
          onsets.add(tick);
        }
      }
    }
    const maxEvents = onsets.size;
    // A collapsed measure's width comes from what it draws — one bar and a
    // number — not from the events it replaced, of which there are none.
    const collapsed = tracks.some(
      (track) => track.measures[measureIndex]?.multiMeasureRestCount !== undefined,
    );
    if (collapsed) return MULTI_REST_MEASURE_WIDTH;

    return Math.max(BASE_MEASURE_WIDTH, maxEvents * NOTE_SLOT_WIDTH + DENSE_MEASURE_PADDING);
  });

  const widthOf = (measureIndex: number, isFirstInSystem: boolean): number =>
    (contentWidths[measureIndex] ?? BASE_MEASURE_WIDTH) + (isFirstInSystem ? headerWidth : 0);

  // `options.width` is a screen-pixel budget; convert to the equivalent
  // logical-unit budget by dividing out zoom (a more zoomed-in view fits
  // fewer logical pixels in the same screen width) before packing systems.
  //
  //
  // Both margins come out of the budget, so a packed system's right edge lands
  // at or inside the viewport and page mode's `totalWidth` below can be exactly
  // that. What is left is what the music itself may occupy.
  //
  // This used to be floored at what one measure needs *with* its margins, which
  // meant that below about 530 logical units the layout simply stopped
  // shrinking — and since page mode hides horizontal overflow, everything past
  // the viewport was permanently invisible. A narrow window clipped it, and so
  // did zooming in, which divides the same window by more. The floor here is
  // only a guard against a zero or negative budget; the per-system scaling
  // below is what keeps the music inside it.
  const contentBudget =
    options.layoutMode === 'continuous'
      ? Number.POSITIVE_INFINITY
      : Math.max(MIN_CONTENT_WIDTH, options.width / zoom - leftMargin - rightMargin);
  const systemsOfIndices = groupIntoSystems(measureCount, widthOf, contentBudget);

  const rowHeight = (count: number): number => (count > 0 ? count * staveHeight + Math.max(0, count - 1) * trackGap : 0);
  const trackRowHeight = rowHeight(tracks.length);

  const trackLayouts: TrackLayout[] = tracks.map((track) => ({ track, measures: [] }));
  const systems: SystemLayout[] = [];

  let maxSystemRight = 0;

  systemsOfIndices.forEach((measureIndices, systemIndex) => {
    const yTop = topMargin + systemIndex * (trackRowHeight + systemGap);
    const yBottom = yTop + trackRowHeight;

    /**
     * Extra width spread across this system's measures so it reaches the
     * margin — what engravers call justification.
     *
     * Without it a system stops wherever the next measure would not have fit,
     * leaving up to a whole measure's width blank at the right. That reads as
     * a mistake on paper and no better on screen.
     *
     * The last system is deliberately left at its natural width: a final line
     * of two bars stretched across the page looks worse than a short one.
     * Continuous mode is never justified — it has no right margin to reach.
     */
    const naturalWidth = measureIndices.reduce(
      (sum, index, position) => sum + widthOf(index, position === 0),
      0,
    );
    const isLastSystem = systemIndex === systemsOfIndices.length - 1;
    // Where this system's right edge should land.
    //
    // Too wide always shrinks, whatever the mode and whichever system it is:
    // page mode hides horizontal overflow, so a system that does not fit is not
    // merely ugly, it is partly unreadable — which is what happened to a bar
    // dense enough to exceed the budget on its own. Only *stretching* is
    // optional, and stays as it was: page mode, and not the final system.
    const target =
      naturalWidth > contentBudget || (options.layoutMode === 'page' && !isLastSystem)
        ? contentBudget
        : naturalWidth;
    // Shared out in proportion to what each measure already occupies, so a
    // dense bar keeps its extra room rather than a sparse one being padded to
    // match it — and, shrinking, gives up room in proportion too.
    const scale = naturalWidth > 0 ? target / naturalWidth : 1;

    let cursorX = leftMargin;
    measureIndices.forEach((measureIndex, positionInSystem) => {
      const isFirstInSystem = positionInSystem === 0;
      const naturalMeasureWidth = widthOf(measureIndex, isFirstInSystem);
      // Rounded to whole units, then the last measure absorbs whatever the
      // rounding lost — otherwise the system lands a pixel or two short and
      // the final barline never quite meets the margin.
      const isLastInSystem = positionInSystem === measureIndices.length - 1;
      const width = isLastInSystem ? leftMargin + target - cursorX : naturalMeasureWidth * scale;

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
