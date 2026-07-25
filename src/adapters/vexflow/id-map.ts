/**
 * Builds the `RenderResult` id maps (spec §7, §26) by walking the SVG a
 * renderer already drew into `container`, keyed off the ids `convert.ts`
 * set via `note.setAttribute('id', vexId)` / `stave.setAttribute('id', ...)`
 * before drawing (VexFlow then emits `id="vf-<vexId>"` on the drawn group —
 * see `SVGContext.openGroup` / `util.prefix`).
 *
 * Kept as a DOM-only post-draw step (rather than reading positions off the
 * VexFlow objects directly) so it works uniformly for notes, rests, and
 * staves without needing bespoke bounding-box math per VexFlow class.
 */
import type { NoteMeta } from './convert.js';
import type { BBox } from './types.js';

const ZERO_BBOX: BBox = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Finds the SVG group VexFlow drew for the element we tagged `vexId` (see
 * module doc). Uses a quoted attribute selector, so `vexId` is safe as-is
 * for any value without an embedded `"` or `\` — true for every id this
 * adapter produces (domain UUIDs from `createId()`, and this module's own
 * `<eventId>::seg<N>` decomposition suffix).
 */
function findGroup(container: HTMLElement, vexId: string): SVGElement | null {
  return container.querySelector(`[id="vf-${vexId}"]`);
}

/**
 * `getBBox()` is SVG-only geometry; guarded because jsdom needs the stub in
 * `src/test/setup.ts` and some detached/zero-size elements can still throw
 * in real browsers (e.g. `display: none` ancestors).
 *
 * `getBBox()` reports coordinates in the element's own SVG user-coordinate
 * system, i.e. the LOGICAL (unscaled) units everything was drawn in — it
 * does not account for the `viewBox`-based `context.scale(zoom, zoom)`
 * `renderer.ts` applies to the whole render. `zoom` is multiplied in here so
 * every box this module returns is in final on-screen pixels, matching
 * `RenderResult.height` (also final on-screen pixels).
 */
function elementBBox(element: SVGElement, zoom: number): BBox {
  const graphicsElement = element as unknown as { getBBox?: () => BBox };
  if (typeof graphicsElement.getBBox !== 'function') return ZERO_BBOX;
  try {
    const box = graphicsElement.getBBox();
    return { x: box.x * zoom, y: box.y * zoom, width: box.width * zoom, height: box.height * zoom };
  } catch {
    return ZERO_BBOX;
  }
}

/**
 * Maps every domain event id referenced by `metas` to the SVG element/bbox
 * VexFlow drew for it. A chord's multiple event ids all map to the same
 * (single) drawn element. A duration-decomposed event's multiple segments
 * all carry the same event id in `eventIds[0]`; the *first* segment drawn
 * wins (documented in `convert.ts`), so later segments are skipped once the
 * id is already present.
 *
 * `zoom` must be the same value passed to `context.scale` in `renderer.ts`,
 * so the returned bboxes are in final on-screen pixels (see `elementBBox`).
 */
export function buildEventMaps(
  container: HTMLElement,
  metas: NoteMeta[],
  zoom: number,
): { idToElement: Map<string, SVGElement>; idToBBox: Map<string, BBox> } {
  const idToElement = new Map<string, SVGElement>();
  const idToBBox = new Map<string, BBox>();

  for (const meta of metas) {
    const element = findGroup(container, meta.vexId);
    if (!element) continue;
    const bbox = elementBBox(element, zoom);
    for (const eventId of meta.eventIds) {
      if (idToElement.has(eventId)) continue;
      idToElement.set(eventId, element);
      idToBBox.set(eventId, bbox);
    }
  }

  return { idToElement, idToBBox };
}

/**
 * Maps each measure id to its drawn stave's bounding box (a `Stave` tagged
 * `stave.setAttribute('id', measureId)`). `zoom` — see `buildEventMaps`.
 */
export function buildMeasureMap(container: HTMLElement, measureIds: Iterable<string>, zoom: number): Map<string, BBox> {
  const measureIdToBBox = new Map<string, BBox>();
  for (const measureId of measureIds) {
    const element = findGroup(container, measureId);
    if (!element) continue;
    measureIdToBBox.set(measureId, elementBBox(element, zoom));
  }
  return measureIdToBBox;
}
