/**
 * VexFlow renderer adapter contract (spec §7, §26): the shared shapes the
 * layout pass (`layout.ts`), the canvas renderer (`canvas-renderer.ts`),
 * and the highlight overlay (`overlay.ts`) all agree on. Downstream apps
 * import these verbatim — keep them stable; add new capabilities alongside
 * them rather than by editing their fields.
 */

/** How a note is colored, by state. See `note-color.ts`'s `resolveNoteColorRole` for precedence. */
export type NoteColorRole = 'normal' | 'selected' | 'regenerated' | 'playing';

/**
 * Colors used to draw the notation. Note state is carried by the notehead's
 * own color — there is no highlight overlay any more (the second canvas and
 * `paintHighlights` were deleted), so every note state needs its own entry
 * here rather than a single `selection`/`playback` stroke color.
 */
export type RenderTheme = {
  /** Non-note glyphs: clefs, key/time signatures, braces, measure numbers. */
  foreground: string;
  noteNormal: string;
  noteSelected: string;
  noteRegenerated: string;
  notePlaying: string;
  /** Stave lines + barlines of the active track. */
  staveActive: string;
  /** Stave lines + barlines of every other track. */
  staveInactive: string;
  /** Playback caret. Drawn as a DOM element by the app, but themed here so every render color lives in one object. */
  caret: string;
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
  /** eventId -> color role. Absent ids render as `normal`. */
  noteColors?: ReadonlyMap<string, NoteColorRole>;
  /** Track whose staves render in `theme.staveActive`; every other track uses `theme.staveInactive`. */
  activeTrackId?: string | null;
  /** Measure ids whose gutter cell is tinted as selected — measure selection's only visual feedback, now that notes carry their own color. */
  selectedMeasureIds?: ReadonlySet<string>;
  theme: RenderTheme;
};

export type BBox = { x: number; y: number; width: number; height: number };
