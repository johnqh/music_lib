/**
 * VexFlow renderer adapter contract (spec §7, §26): the shared shapes the
 * layout pass (`layout.ts`), the canvas renderer (`canvas-renderer.ts`),
 * and the highlight overlay (`overlay.ts`) all agree on. Downstream apps
 * import these verbatim — keep them stable; add new capabilities alongside
 * them rather than by editing their fields.
 */

/** Colors used to draw the notation and paint highlight states; see `paintHighlights` in `overlay.ts`. */
export type RenderTheme = {
  foreground: string;
  selection: string;
  playback: string;
  preview: string;
};

export type RenderOptions = {
  /** Linear scale factor applied to the whole render (measure width, stave height, font size). */
  zoom: number;
  /** "page" wraps systems to fit `width`; "continuous" lays out every measure in one long system. */
  layoutMode: 'page' | 'continuous';
  /** Available width in pixels (page mode wraps to this; continuous mode ignores it for layout). */
  width: number;
  /** Track ids to render, in the order they should be stacked top-to-bottom; omit/empty = all tracks in score order. */
  trackIds?: string[];
  theme: RenderTheme;
};

export type BBox = { x: number; y: number; width: number; height: number };
