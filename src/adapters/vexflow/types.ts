/**
 * VexFlow renderer adapter contract (spec §7, §26).
 *
 * This file is the cross-task contract: Task 12 (score editor feature)
 * imports `ScoreRenderer`, `RenderOptions`, `RenderResult`, and
 * `ScoreChangeSet` verbatim. Keep these four shapes stable; add new
 * capabilities alongside them (e.g. as extra exported types/functions)
 * rather than by editing their fields.
 */
import type { Score } from '@sudobility/music_types';

/** Colors used to paint highlight states; see `applyHighlights` in `renderer.ts`. */
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
  /**
   * Virtualization (spec §26 "Render only visible systems where
   * practical"; §29 virtualization for long scores): when set, only
   * measures whose index is in this set get their stave/notes/beams/ties
   * actually built and drawn — every other measure is skipped entirely
   * (no stave, no `RenderResult` entries for its events). The canvas is
   * still sized from the *full* layout (`adapters/vexflow/layout.ts`'s
   * `computeLayout`, always run over every measure regardless of this
   * option), so skipped measures simply leave their already-reserved
   * space blank rather than shrinking the canvas — scroll position and
   * geometry stay stable as the visible set changes between renders.
   * `undefined`/omitted renders every measure, matching pre-Task-17
   * behavior exactly.
   */
  visibleMeasureIndices?: ReadonlySet<number>;
};

export type BBox = { x: number; y: number; width: number; height: number };

export type RenderResult = {
  /** Note/rest event id -> the SVG group VexFlow drew it into. */
  idToElement: Map<string, SVGElement>;
  /** Note/rest event id -> that element's bounding box (page coordinates, SVG user units). */
  idToBBox: Map<string, BBox>;
  /**
   * Measure id -> that measure's stave bounding box. Domain measures are
   * per-track (each `Track.measures[i]` has its own id — spec §4), so this
   * is naturally one entry per rendered (track, measure) stave, not a value
   * unioned across tracks.
   */
  measureIdToBBox: Map<string, BBox>;
  /** Total rendered height in pixels; combine with `options.width` (page) or the natural content width (continuous) for the viewport. */
  height: number;
  /**
   * The theme this result was rendered with — carried through so
   * `applyHighlights` (and any caller wanting to restore an element to its
   * unhighlighted appearance) always has the correct colors without having
   * to separately track which theme produced this result. Additive to the
   * brief's four core fields, not a replacement for any of them.
   */
  theme: RenderTheme;
};

/**
 * `"all"`: re-render everything. `{ dirtyMeasureIds }`: only these measures'
 * content changed (their notes/rests/voices) — reserved for a future
 * incremental `update`; the Task 11 MVP `update` always re-renders fully
 * regardless of which variant is passed (see `renderer.ts`).
 */
export type ScoreChangeSet = { dirtyMeasureIds: string[] } | 'all';

export interface ScoreRenderer {
  render(score: Score, container: HTMLElement, options: RenderOptions): RenderResult;
  update(score: Score, changes: ScoreChangeSet, container: HTMLElement, previous: RenderResult): RenderResult;
  dispose(): void;
}
