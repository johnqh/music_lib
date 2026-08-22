/**
 * Draws `InstrumentIconArt` onto a 2D canvas context.
 *
 * The SVG side of the same art lives in the app's `InstrumentIcon` component;
 * both replay the shape list, so an icon added to `gm-icon.ts` appears in the
 * gutter and the DOM without either renderer being touched.
 */
import {
  ICON_STROKE_WIDTH,
  ICON_VIEWBOX,
  parseIconPath,
} from '@sudobility/music_types';
import type { IconShape, InstrumentIconArt } from '@sudobility/music_types';

function appendShape(ctx: CanvasRenderingContext2D, shape: IconShape): void {
  if (shape.kind === 'circle') {
    // `arc` draws a line from the current point to the arc's start, which
    // would tie every circle to whatever was drawn before it.
    ctx.moveTo(shape.cx + shape.r, shape.cy);
    ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
    return;
  }

  for (const segment of parseIconPath(shape.d)) {
    switch (segment.kind) {
      case 'move':
        ctx.moveTo(segment.x, segment.y);
        break;
      case 'line':
        ctx.lineTo(segment.x, segment.y);
        break;
      case 'cubic':
        ctx.bezierCurveTo(
          segment.x1,
          segment.y1,
          segment.x2,
          segment.y2,
          segment.x,
          segment.y
        );
        break;
      case 'quad':
        ctx.quadraticCurveTo(segment.x1, segment.y1, segment.x, segment.y);
        break;
      case 'close':
        ctx.closePath();
        break;
    }
  }
}

/**
 * Strokes `art` in the current `strokeStyle`, scaled into a `size`-square box
 * whose top-left corner is (`x`, `y`).
 *
 * One `beginPath`/`stroke` pair for the whole icon: the shapes are all the same
 * colour and weight, so there is nothing to gain from stroking them separately.
 * `save`/`restore` bracket the transform, so the caller's — the gutter's pinned,
 * zoom-and-DPR-scaled one — survives.
 */
export function strokeInstrumentIcon(
  ctx: CanvasRenderingContext2D,
  art: InstrumentIconArt,
  x: number,
  y: number,
  size: number
): void {
  const scale = size / ICON_VIEWBOX;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  // Set inside the scaled space, so the weight scales with the art rather than
  // going hairline at gutter size and heavy at display size.
  ctx.lineWidth = ICON_STROKE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  for (const shape of art.shapes) appendShape(ctx, shape);
  ctx.stroke();

  ctx.restore();
}
