/**
 * Highlight overlay painter for the canvas notation renderer: paints
 * selection / playback / preview cues onto a separate viewport-sized
 * overlay canvas, so highlight changes never redraw the notation itself
 * (the same "highlights don't re-render" property `applyHighlights` gave
 * the SVG path via DOM style mutation).
 *
 * Non-color cues (spec §27 "Do not rely on color alone"): each kind keeps
 * a distinct stroke pattern, mirroring the SVG outline styles —
 * selected = solid, playing = dashed, preview = dotted. Precedence when an
 * id is in multiple sets: preview < selected < playing (painted in that
 * order; the later stroke overdraws).
 */
import type { HighlightSets } from './renderer.js';
import type { CanvasRenderResult } from './canvas-renderer.js';
import type { BBox } from './types.js';

export type OverlayOptions = {
  /** Scroll offset in CSS px (zoom-scaled content coords — the same units as the result's bboxes). */
  viewportTop: number;
  /** Backing-store scale (window.devicePixelRatio); default 1. */
  devicePixelRatio?: number;
};

const OUTLINE_PADDING = 1;
const OUTLINE_WIDTH = 2;
const DASH: Record<'selected' | 'playing' | 'preview', number[]> = {
  selected: [],
  playing: [6, 3],
  preview: [2, 3],
};

function paintSet(
  ctx: CanvasRenderingContext2D,
  result: CanvasRenderResult,
  ids: string[],
  kind: 'selected' | 'playing' | 'preview',
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.setLineDash(DASH[kind]);
  for (const id of ids) {
    const box: BBox | undefined = result.idToBBox.get(id);
    if (!box) continue; // outside the drawn window (or no bbox recorded) — nothing to paint
    ctx.strokeRect(
      box.x - OUTLINE_PADDING,
      box.y - OUTLINE_PADDING,
      box.width + OUTLINE_PADDING * 2,
      box.height + OUTLINE_PADDING * 2,
    );
  }
}

/** Clears the overlay and paints all three highlight kinds for the drawn window. Call on any selection/playback/preview change and after every notation redraw. */
export function paintHighlights(
  ctx: CanvasRenderingContext2D,
  result: CanvasRenderResult,
  highlights: HighlightSets,
  options: OverlayOptions,
): void {
  const dpr = options.devicePixelRatio ?? 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, -options.viewportTop * dpr);

  paintSet(ctx, result, highlights.previewIds, 'preview', result.theme.preview);
  paintSet(ctx, result, highlights.selectedIds, 'selected', result.theme.selection);
  paintSet(ctx, result, highlights.playingIds, 'playing', result.theme.playback);
  ctx.setLineDash([]);
}
