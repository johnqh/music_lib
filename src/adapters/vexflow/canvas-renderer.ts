/**
 * Windowed canvas score renderer (spec: canvas-notation-renderer design):
 * draws ONLY the systems intersecting the caller's viewport into a
 * caller-managed 2D context, through VexFlow's `CanvasContext`. Per-frame
 * cost is O(visible systems); the one O(n) pass (`computeLayout`) is cached
 * and reused until score/zoom/layout-mode/width/trackIds change — a
 * viewport change alone never recomputes layout.
 *
 * No DOM anywhere: bounding boxes come from the VexFlow objects themselves
 * (`element.getBoundingBox()`), in zoom-scaled CSS px, content coordinates.
 * The theme foreground is set as the context's fill/stroke before drawing.
 * A draw failure in one system logs and skips that system, and the rest
 * still draw — a corrupt measure must not blank the whole canvas.
 *
 * Pure canvas adapter: no store/React imports (spec §3, §37).
 */
import { CanvasContext, Formatter, Stave, StaveConnector } from 'vexflow';
import type { Beam, Voice } from 'vexflow';
import type { Score } from '@sudobility/music_types';
import { buildMeasureContent, buildTies } from './measure-content.js';
import type { Channel } from './measure-content.js';
import { computeLayout, resolveZoom } from './layout.js';
import type { LayoutPlan, SystemLayout } from './layout.js';
import type { BBox, RenderOptions, RenderTheme } from './types.js';
import type { NoteMeta } from './convert.js';

/**
 * Logical (unscaled) content-coordinate window to draw: typically
 * `scrollTop/zoom` .. `(scrollTop+clientHeight)/zoom`. `left`/`right`
 * (defaults: 0/∞ — full width, page-mode behavior) window the draw
 * horizontally too: continuous mode lays every measure in ONE system, so
 * without them each frame would draw the entire score.
 */
export type CanvasViewport = { top: number; bottom: number; left?: number; right?: number };

export type CanvasRenderOptions = RenderOptions & {
  viewport: CanvasViewport;
  /** Backing-store scale (window.devicePixelRatio); default 1. The canvas element's width/height must already be sized to cssSize × this. */
  devicePixelRatio?: number;
};

export type CanvasRenderResult = {
  /** Note/rest event id -> bbox, zoom-scaled CSS px, content coordinates (scroll NOT subtracted). Drawn window only. */
  idToBBox: Map<string, BBox>;
  /** Measure id -> its stave box (from the layout plan), same units. Drawn window only; one entry per (track, measure). */
  measureIdToBBox: Map<string, BBox>;
  drawnMeasureIndices: Set<number>;
  /** The (cached) full-score layout this frame was drawn against. */
  plan: LayoutPlan;
  theme: RenderTheme;
};

type BoundingBoxLike = { getX(): number; getY(): number; getW(): number; getH(): number };

/** Width kept free at the end of each measure's note area so the final glyph never crosses the barline — see the joint-format comment in `drawSystem`. */
const BARLINE_CLEARANCE = 12;

export class CanvasScoreRenderer {
  private cache: { key: string; score: Score; plan: LayoutPlan } | null = null;

  private planFor(score: Score, options: CanvasRenderOptions): LayoutPlan {
    const key = JSON.stringify([options.zoom, options.layoutMode, options.width, options.trackIds ?? null]);
    if (this.cache && this.cache.score === score && this.cache.key === key) return this.cache.plan;
    const plan = computeLayout(score, options);
    this.cache = { key, score, plan };
    return plan;
  }

  render(score: Score, ctx: CanvasRenderingContext2D, options: CanvasRenderOptions): CanvasRenderResult {
    const z = resolveZoom(options.zoom);
    const dpr = options.devicePixelRatio ?? 1;
    const plan = this.planFor(score, options);

    const viewportLeft = options.viewport.left ?? 0;
    const viewportRight = options.viewport.right ?? Number.POSITIVE_INFINITY;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // `+ 0` normalizes -0 (from a zero scroll offset) to 0.
    ctx.setTransform(z * dpr, 0, 0, z * dpr, -viewportLeft * z * dpr + 0, -options.viewport.top * z * dpr + 0);

    const vexCtx = new CanvasContext(ctx);
    vexCtx.setFillStyle(options.theme.foreground);
    vexCtx.setStrokeStyle(options.theme.foreground);

    const idToBBox = new Map<string, BBox>();
    const measureIdToBBox = new Map<string, BBox>();
    const drawnMeasureIndices = new Set<number>();
    /** trackId -> voiceOrdinal -> accumulated channel, across every drawn system in order (cross-system tie continuity within the window). */
    const channelsByTrack = new Map<string, Map<number, Channel>>();
    for (const track of plan.tracks) channelsByTrack.set(track.id, new Map());

    const visibleSystems = plan.systems.filter(
      (s) => s.yBottom >= options.viewport.top && s.yTop <= options.viewport.bottom,
    );

    for (const system of visibleSystems) {
      try {
        this.drawSystem(system, plan, score, vexCtx, z, channelsByTrack, measureIdToBBox, drawnMeasureIndices, viewportLeft, viewportRight);
      } catch (error) {
        // One corrupt system must not blank the rest of the sheet.
        console.error('CanvasScoreRenderer: skipping system after draw failure', system.measureIndices, error);
      }
    }

    // Ties span measures (and systems) within the drawn window; draw last, on top.
    for (const channels of channelsByTrack.values()) {
      for (const channel of channels.values()) {
        try {
          for (const tie of buildTies(channel)) {
            tie.setContext(vexCtx);
            tie.draw();
          }
        } catch (error) {
          console.error('CanvasScoreRenderer: skipping ties after draw failure', error);
        }
        // Event bboxes from the VexFlow objects (post-format): first
        // decomposition segment wins per event id, so a tied long note's
        // click target is its first drawn glyph.
        for (const entry of channel) {
          this.recordEventBBox(entry.note as unknown as { getBoundingBox(): BoundingBoxLike | undefined }, entry.meta, z, idToBBox);
        }
      }
    }

    return { idToBBox, measureIdToBBox, drawnMeasureIndices, plan, theme: options.theme };
  }

  private recordEventBBox(
    note: { getBoundingBox(): BoundingBoxLike | undefined },
    meta: NoteMeta,
    z: number,
    idToBBox: Map<string, BBox>,
  ): void {
    let box: BBox | null = null;
    try {
      const bb = note.getBoundingBox();
      if (bb) box = { x: bb.getX() * z, y: bb.getY() * z, width: bb.getW() * z, height: bb.getH() * z };
    } catch {
      box = null; // a missing bbox only disables clicking this glyph
    }
    if (!box) return;
    for (const eventId of meta.eventIds) {
      if (!idToBBox.has(eventId)) idToBBox.set(eventId, box);
    }
  }

  /**
   * The contiguous slice of `system.measureIndices` whose stave boxes
   * intersect `[left, right]`, found by binary search over the x-sorted
   * measure layouts — O(log n), so a continuous-mode frame never scans the
   * whole single-system score (the horizontal analogue of the y-based
   * system filter).
   */
  private visibleMeasureIndices(
    system: SystemLayout,
    plan: LayoutPlan,
    left: number,
    right: number,
  ): number[] {
    const indices = system.measureIndices;
    const measures = plan.trackLayouts[0]?.measures;
    if (!measures || indices.length === 0) return indices;
    if (left <= 0 && right === Number.POSITIVE_INFINITY) return indices;

    // First index whose box right edge reaches `left`.
    let lo = 0;
    let hi = indices.length - 1;
    let start = indices.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const box = measures[indices[mid]]?.box;
      if (!box || box.x + box.width < left) lo = mid + 1;
      else {
        start = mid;
        hi = mid - 1;
      }
    }
    // Last index whose box left edge is within `right`.
    lo = start;
    hi = indices.length - 1;
    let end = start - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const box = measures[indices[mid]]?.box;
      if (!box || box.x <= right) {
        end = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return indices.slice(start, end + 1);
  }

  private drawSystem(
    system: SystemLayout,
    plan: LayoutPlan,
    score: Score,
    vexCtx: CanvasContext,
    z: number,
    channelsByTrack: Map<string, Map<number, Channel>>,
    measureIdToBBox: Map<string, BBox>,
    drawnMeasureIndices: Set<number>,
    viewportLeft: number,
    viewportRight: number,
  ): void {
    const staves: Stave[] = [];
    const voicesToDraw: Voice[] = [];
    const beamsToDraw: Beam[] = [];
    /** trackIndex -> the system's first-measure stave, for the brace connector. */
    const firstStaveByTrack = new Map<number, Stave>();
    const allMetas: NoteMeta[] = []; // buildMeasureContent appends; unused here (channels carry the metas)

    // Measure-first iteration: every track's content for one measure index
    // is built and then formatted through ONE shared Formatter, so
    // simultaneous events land at the same x on every stave (VexFlow's
    // multi-stave contract: joinVoices per stave, one format() over all).
    // Formatting each track's measure independently — the old structure —
    // let a dense track distribute its notes on its own timeline, visually
    // desynchronized from the other tracks' staves.
    const windowIndices = this.visibleMeasureIndices(system, plan, viewportLeft, viewportRight);
    for (const measureIndex of windowIndices) {
      const measureStaves: Stave[] = [];
      const voiceGroups: Voice[][] = [];

      plan.trackLayouts.forEach(({ track }, trackIndex) => {
        const placement = plan.trackLayouts[trackIndex].measures[measureIndex];
        const measure = track.measures[measureIndex];
        if (!placement || !measure) return;

        const channels = channelsByTrack.get(track.id)!;
        const prevMeasure = track.measures[measureIndex - 1];
        const { stave, voices, beams } = buildMeasureContent(
          measure,
          track,
          placement,
          prevMeasure,
          score.ppq,
          channels,
          allMetas,
        );
        stave.setContext(vexCtx);
        stave.format();
        staves.push(stave);
        measureStaves.push(stave);
        beamsToDraw.push(...beams);
        if (measureIndex === system.measureIndices[0]) firstStaveByTrack.set(trackIndex, stave);

        if (voices.length > 0) {
          voices.forEach((v) => v.setStave(stave));
          voiceGroups.push(voices);
        }

        measureIdToBBox.set(measure.id, {
          x: placement.box.x * z,
          y: placement.box.y * z,
          width: placement.box.width * z,
          height: placement.box.height * z,
        });
        if (trackIndex === 0) drawnMeasureIndices.add(measureIndex);
      });

      // Align the clef/key/time blocks so every stave's note area starts at
      // the same x, then joint-format to the narrowest note area. The
      // clearance keeps the last event's glyph (notehead + stem/flag, drawn
      // rightward of its tick x) short of the barline: format() justifies
      // ticks across the FULL given width, so without it the final glyph
      // always overhangs into the next measure regardless of measure width.
      if (measureStaves.length > 1) Stave.formatBegModifiers(measureStaves);
      if (voiceGroups.length > 0) {
        const formatter = new Formatter();
        for (const group of voiceGroups) formatter.joinVoices(group);
        const justifyWidth = Math.max(
          20,
          Math.min(...measureStaves.map((s) => s.getNoteEndX() - s.getNoteStartX())) -
            BARLINE_CLEARANCE,
        );
        formatter.format(voiceGroups.flat(), justifyWidth);
        voicesToDraw.push(...voiceGroups.flat());
      }
    }

    // Draw order: staves, then notes/voices, then beams on top (ties drawn later, cross-system).
    staves.forEach((s) => s.draw());
    voicesToDraw.forEach((v) => v.draw(vexCtx));
    beamsToDraw.forEach((b) => {
      b.setContext(vexCtx);
      b.draw();
    });

    if (plan.tracks.length > 1) {
      const topStave = firstStaveByTrack.get(0);
      const bottomStave = firstStaveByTrack.get(plan.tracks.length - 1);
      if (topStave && bottomStave && topStave !== bottomStave) {
        const connector = new StaveConnector(topStave, bottomStave);
        connector.setType('brace');
        connector.setContext(vexCtx);
        connector.draw();
      }
    }
  }

  dispose(): void {
    this.cache = null;
  }
}
