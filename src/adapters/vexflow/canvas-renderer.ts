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
import { CanvasContext, Formatter, Stave, StaveConnector, MultiMeasureRest } from 'vexflow';
import type { Beam, StaveNote, Voice } from 'vexflow';
import { noteColorFor, noteEmphasisFor, resolveNoteColorRole } from './note-color.js';
import { trackInstrumentIcon } from '../../domain/instruments/track-instrument.js';
import { strokeInstrumentIcon } from './icon-canvas.js';
import type { Score } from '@sudobility/music_types';
import { buildMeasureContent, buildTies } from './measure-content.js';
import type { Channel } from './measure-content.js';
import {
  MEASURE_HEADER_HEIGHT,
  STAVE_TOP_LINE_OFFSET,
  TRACK_INFO_WIDTH,
  computeLayout,
  resolveZoom,
} from './layout.js';
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

/** Measure-number type, and where it sits inside the gutter band. */
const GUTTER_FONT = '11px sans-serif';
const GUTTER_FONT_SELECTED = 'bold 11px sans-serif';
const GUTTER_TEXT_INSET = 3;
/** Distance from the band's bottom edge up to the text baseline, so numbers sit just above the stave. */
const GUTTER_TEXT_BASELINE_INSET = 5;
/** Selected-measure tint opacity: enough to read as "selected", light enough to keep the notes over it legible. */
const MEASURE_SELECTION_ALPHA = 0.16;

/**
 * Track-info gutter type and insets.
 *
 * Sized for the 220px column `layout.ts` reserves rather than for the margin
 * this text used to live in: at 11-12px it read as a caption on a panel that
 * has room for a label, and the instrument line in particular is something you
 * check while reading the staff beside it.
 */
const TRACK_INFO_NAME_FONT = 'bold 14px sans-serif';
const TRACK_INFO_DETAIL_FONT = '13px sans-serif';
/** Side of the square the instrument's line art is drawn into. */
const TRACK_INFO_ICON_SIZE = 16;
/** Space the instrument icon occupies before its name. */
const TRACK_INFO_ICON_WIDTH = 22;
const TRACK_INFO_INSET = 10;
/** Gap between the gutter's three rows, name to instrument to state. */
const TRACK_INFO_LINE_GAP = 18;

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
        this.drawSystem(system, plan, score, vexCtx, ctx, z, channelsByTrack, measureIdToBBox, drawnMeasureIndices, viewportLeft, viewportRight, options);
      } catch (error) {
        // One corrupt system must not blank the rest of the sheet.
        console.error('CanvasScoreRenderer: skipping system after draw failure', system.measureIndices, error);
      }
    }

    // Ties span measures (and systems) within the drawn window; draw last, on top.
    for (const [trackId, channels] of channelsByTrack) {
      const tieColor = this.trackColor(this.notesDimmed(trackId, options), options);
      for (const channel of channels.values()) {
        try {
          for (const tie of buildTies(channel)) {
            tie.setStyle({ fillStyle: tieColor, strokeStyle: tieColor });
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

    // Last, so it overlays any content that scrolled underneath it — and not
    // at all for print, where there is nothing to click.
    if (options.showTrackInfo ?? true) {
      this.drawTrackInfoGutter(plan, ctx, z, dpr, visibleSystems, options);
    }

    return { idToBBox, measureIdToBBox, drawnMeasureIndices, plan, theme: options.theme };
  }

  /**
   * The track-info gutter: name, instrument and mute/solo state beside every
   * stave, for every visible system.
   *
   * Pinned to the viewport's left edge rather than drawn at content x=0. In
   * continuous mode the score is one very wide system scrolled horizontally, so
   * a gutter in content space would slide out of view — the one thing a
   * permanent label column cannot do. The vertical scroll is kept, so the
   * labels still track their staves.
   *
   * Reads `name`/`instrumentName`/`muted`/`solo` straight off the live `Track`,
   * so there is no render option to keep in sync. Alignment is structural: the
   * gutter is the space `layout.ts` reserved via `TRACK_INFO_WIDTH`, in the
   * same coordinate space as the staves.
   */
  private drawTrackInfoGutter(
    plan: LayoutPlan,
    ctx: CanvasRenderingContext2D,
    z: number,
    dpr: number,
    visibleSystems: SystemLayout[],
    options: CanvasRenderOptions,
  ): void {
    if (plan.trackLayouts.length === 0) return;

    const previousFill = ctx.fillStyle;
    const previousStroke = ctx.strokeStyle;
    const previousFont = ctx.font;

    // Same transform, minus the horizontal scroll: pins x, keeps y tracking.
    ctx.setTransform(z * dpr, 0, 0, z * dpr, 0, -options.viewport.top * z * dpr + 0);

    for (const system of visibleSystems) {
      const measureIndex = system.measureIndices[0];

      // `clearRect`, not a fill: clearing shows whatever is behind the canvas,
      // which is exactly the surface the sheet sits on — so the gutter's
      // background matches the sheet's by construction and cannot drift from
      // it the way a theme colour could. It also occludes the content that
      // scrolled underneath, which is the other thing this needs to do.
      ctx.clearRect(0, system.gutterTop, TRACK_INFO_WIDTH, system.yBottom - system.gutterTop);

      for (const trackLayout of plan.trackLayouts) {
        const placement = trackLayout.measures.find((m) => m.measureIndex === measureIndex);
        if (!placement) continue;
        const track = trackLayout.track;
        const isActive = options.activeTrackId != null && track.id === options.activeTrackId;
        ctx.fillStyle = isActive ? options.theme.staveActive : options.theme.staveInactive;

        // The instrument row is aligned to the stave's **top line** — the
        // first thing the reader's eye lands on — rather than to the top of the
        // track's box, which is headroom VexFlow reserves and nothing is drawn
        // in. The track name then sits on the line above it, inside that same
        // headroom, so the pair reads downward into the music: whose staff this
        // is, then what it sounds like, then the staff itself.
        const staveTopLine = placement.box.y + STAVE_TOP_LINE_OFFSET;
        // Baseline sits at the icon's foot, so glyph and text share a bottom
        // edge and the row's *top* is the stave line.
        const detailBaseline = staveTopLine + TRACK_INFO_ICON_SIZE - 1;

        ctx.font = TRACK_INFO_NAME_FONT;
        ctx.fillText(track.name, TRACK_INFO_INSET, detailBaseline - TRACK_INFO_LINE_GAP);

        // Icon then instrument name, so the glyph reads as a label for the text
        // beside it rather than decoration floating on its own. The icon is
        // stroked, so it takes the same active/inactive colour as the text.
        ctx.strokeStyle = ctx.fillStyle;
        strokeInstrumentIcon(
          ctx,
          // Through the track: on a percussion track `midiProgram` addresses a
          // drum kit, so the melodic art at that number is the wrong picture.
          trackInstrumentIcon(track),
          TRACK_INFO_INSET,
          staveTopLine,
          TRACK_INFO_ICON_SIZE,
        );

        ctx.font = TRACK_INFO_DETAIL_FONT;
        ctx.fillText(
          track.instrumentName,
          TRACK_INFO_INSET + TRACK_INFO_ICON_WIDTH,
          detailBaseline,
        );

        // Mute/solo are the only state here that changes what you hear, so they
        // are worth showing without making the track active first.
        const stateBaseline = detailBaseline + TRACK_INFO_LINE_GAP;
        if (track.muted) ctx.fillText('M', TRACK_INFO_INSET, stateBaseline);
        if (track.solo) ctx.fillText('S', TRACK_INFO_INSET + 14, stateBaseline);
      }
    }

    ctx.fillStyle = previousFill;
    ctx.strokeStyle = previousStroke;
    ctx.font = previousFont;
  }

  /**
   * Styles one VexFlow note by the highest-precedence role among the domain
   * events it represents (>1 for a chord, or for one segment of a
   * duration-decomposed long note).
   *
   * Both `fillStyle` and `strokeStyle` are set: noteheads fill, stems and
   * flags stroke, and a note whose stem stayed the default color would read
   * as half-highlighted.
   *
   * `lineWidth` carries the same state redundantly *without* color (spec §27)
   * — see `noteEmphasisFor`, including why this is not a shadow.
   */
  private styleNote(
    note: StaveNote,
    meta: NoteMeta,
    dimmed: boolean,
    options: CanvasRenderOptions,
  ): void {
    const role = resolveNoteColorRole(meta.eventIds, options.noteColors);
    const color = noteColorFor(role, options.theme, !dimmed);
    note.setStyle({
      fillStyle: color,
      strokeStyle: color,
      lineWidth: noteEmphasisFor(role).lineWidth,
    });
  }

  /**
   * Whether `trackId` is *the* active track. With no active track set, nothing
   * is active, so every stave draws in `staveInactive` — the neutral state.
   */
  private isActiveTrack(trackId: string, options: CanvasRenderOptions): boolean {
    return options.activeTrackId != null && trackId === options.activeTrackId;
  }

  /**
   * Whether a track's notes should dim.
   *
   * Deliberately not `!isActiveTrack`. Dimming is *relative* — it says "this
   * track is not the one you are working on" — so with no active track set
   * there is nothing to be relative to and no note dims. Stave lines can sit in
   * their neutral colour without looking wrong; every note in the score going
   * grey would just look washed out.
   */
  private notesDimmed(trackId: string, options: CanvasRenderOptions): boolean {
    return options.activeTrackId != null && trackId !== options.activeTrackId;
  }

  /** The unstyled-note color for a track, which its beams and ties follow. */
  private trackColor(dimmed: boolean, options: CanvasRenderOptions): string {
    return dimmed ? options.theme.noteInactive : options.theme.noteNormal;
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
    /** The raw 2D context behind `vexCtx`: the measure gutter is a number and a rect, so it needs nothing VexFlow provides. */
    ctx: CanvasRenderingContext2D,
    z: number,
    channelsByTrack: Map<string, Map<number, Channel>>,
    measureIdToBBox: Map<string, BBox>,
    drawnMeasureIndices: Set<number>,
    viewportLeft: number,
    viewportRight: number,
    options: CanvasRenderOptions,
  ): void {
    const staves: Array<{ stave: Stave; dimmed: boolean }> = [];
    const voicesToDraw: Voice[] = [];
    const beamsToDraw: Array<{ beam: Beam; dimmed: boolean }> = [];
    const restsToDraw: MultiMeasureRest[] = [];
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
    this.paintSelectedMeasures(system, plan, ctx, windowIndices, options);

    for (const measureIndex of windowIndices) {
      const measureStaves: Stave[] = [];
      const voiceGroups: Voice[][] = [];

      plan.trackLayouts.forEach(({ track }, trackIndex) => {
        const placement = plan.trackLayouts[trackIndex].measures[measureIndex];
        const measure = track.measures[measureIndex];
        if (!placement || !measure) return;

        const channels = channelsByTrack.get(track.id)!;
        const prevMeasure = track.measures[measureIndex - 1];
        const { stave, voices, beams, multiMeasureRest } = buildMeasureContent(
          measure,
          track,
          placement,
          prevMeasure,
          score.ppq,
          channels,
          allMetas,
        );
        // Stave lines only. `Stave.draw` calls `restoreStyle()` *before*
        // drawing its modifiers (clef / key signature / time signature), so
        // this never reaches those glyphs — they draw in whatever the context
        // carries, which is why the draw loop below sets that per stave.
        const isActiveTrack = this.isActiveTrack(track.id, options);
        stave.setStyle({
          strokeStyle: isActiveTrack ? options.theme.staveActive : options.theme.staveInactive,
        });
        stave.setContext(vexCtx);
        stave.format();
        staves.push({ stave, dimmed: this.notesDimmed(track.id, options) });
        measureStaves.push(stave);
        for (const beam of beams) beamsToDraw.push({ beam, dimmed: this.notesDimmed(track.id, options) });
        if (multiMeasureRest) {
          multiMeasureRest.setStave(stave);
          restsToDraw.push(multiMeasureRest);
        }
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

    // Color every note in the window before anything draws. `StaveNote.draw`
    // wraps its whole body (noteheads, stem, flag, and its modifiers) in
    // applyStyle/restoreStyle, so one setStyle per note is enough — the
    // accidentals and dots inherit it from the context.
    //
    // Walks the accumulated channels rather than just this measure's notes:
    // entries carried over from earlier systems in the same frame get
    // restyled too, which is idempotent and cheap (channels only ever hold
    // the drawn window, so this stays O(visible)).
    for (const [trackId, channels] of channelsByTrack) {
      const dimmed = this.notesDimmed(trackId, options);
      for (const channel of channels.values()) {
        for (const entry of channel) {
          this.styleNote(entry.note, entry.meta, dimmed, options);
        }
      }
    }

    // Draw order: staves, then notes/voices, then beams on top (ties drawn later, cross-system).
    // Per stave, not once for the frame: a stave's modifiers (clef, key and
    // time signature) draw from the context, so this is the only place they can
    // pick up their track's dimming. Without it a dimmed track kept a
    // full-strength clef sitting over its greyed notes, which read as a
    // rendering fault rather than as an inactive track.
    staves.forEach(({ stave, dimmed }) => {
      const color = dimmed ? options.theme.noteInactive : options.theme.foreground;
      vexCtx.setFillStyle(color);
      vexCtx.setStrokeStyle(color);
      stave.draw();
    });
    vexCtx.setFillStyle(options.theme.foreground);
    vexCtx.setStrokeStyle(options.theme.foreground);
    voicesToDraw.forEach((v) => v.draw(vexCtx));
    // After the formatter has run, so the stave's final geometry is settled.
    for (const rest of restsToDraw) rest.setContext(vexCtx).draw();

    beamsToDraw.forEach(({ beam, dimmed }) => {
      const color = this.trackColor(dimmed, options);
      beam.setStyle({ fillStyle: color, strokeStyle: color });
      beam.setContext(vexCtx);
      beam.draw();
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

    this.drawMeasureGutter(system, plan, ctx, windowIndices, options);
  }

  /**
   * Tints every selected measure across the full height of the system.
   *
   * The whole bar, not a mark near it: a selection's *extent* is the thing that
   * has to be legible — "these four bars, on every staff" — and the 2px rule
   * this replaces stated that in the one strip of the sheet nobody is looking
   * at. Spanning the system rather than one track's stave is deliberate, and
   * matches what the selection means: the measure gutter is one band per
   * system, and replacing a measure region acts on every track in it.
   *
   * Drawn **before** the staves and notes so it reads as paper the music sits
   * on. Over the top it would tint the noteheads themselves, and a selected
   * bar's notes would not match the same notes anywhere else.
   */
  private paintSelectedMeasures(
    system: SystemLayout,
    plan: LayoutPlan,
    ctx: CanvasRenderingContext2D,
    windowIndices: number[],
    options: CanvasRenderOptions,
  ): void {
    const selected = options.selectedMeasureIds;
    if (!selected || selected.size === 0) return;
    const measures = plan.trackLayouts[0]?.measures;
    const track = plan.tracks[0];
    if (!measures || !track) return;

    const previousFill = ctx.fillStyle;
    const previousAlpha = ctx.globalAlpha;
    ctx.fillStyle = options.theme.noteSelected;
    ctx.globalAlpha = MEASURE_SELECTION_ALPHA;

    for (const measureIndex of windowIndices) {
      const measure = track.measures[measureIndex];
      if (!measure || !selected.has(measure.id)) continue;
      const box = measures.find((m) => m.measureIndex === measureIndex)?.box;
      if (!box) continue;
      // From the number band down to the foot of the last stave, so the tint
      // takes in the measure number as well as every track's bar. Full width
      // and flush with the next bar, so a multi-measure selection is one block
      // rather than a row of stripes.
      ctx.fillRect(box.x, system.gutterTop, box.width, system.yBottom - system.gutterTop);
    }

    ctx.globalAlpha = previousAlpha;
    ctx.fillStyle = previousFill;
  }

  /**
   * Measure numbers in the band above the system's top stave, with any
   * measure in `selectedMeasureIds` picked out in the selection colour.
   *
   * Extent is carried by `paintSelectedMeasures`, which tints the bar itself;
   * this only has to say which number belongs to it. It used to draw a 2px rule
   * under the number instead, which was the only thing showing how far a
   * selection reached and was easy to miss entirely.
   *
   * Drawn straight to the 2D context: there is no VexFlow object for "the
   * space above a stave", and a number plus a rect needs none. Measure
   * geometry comes off track 0 because every track shares one measure grid
   * (see `rebuildMeasureTicks`), which is what lets one gutter serve the
   * whole system.
   */
  private drawMeasureGutter(
    system: SystemLayout,
    plan: LayoutPlan,
    ctx: CanvasRenderingContext2D,
    windowIndices: number[],
    options: CanvasRenderOptions,
  ): void {
    const measures = plan.trackLayouts[0]?.measures;
    const track = plan.tracks[0];
    if (!measures || !track) return;

    const previousFill = ctx.fillStyle;
    const previousFont = ctx.font;
    const baselineY = system.gutterTop + MEASURE_HEADER_HEIGHT - GUTTER_TEXT_BASELINE_INSET;

    for (const measureIndex of windowIndices) {
      const placement = measures.find((m) => m.measureIndex === measureIndex);
      const measure = track.measures[measureIndex];
      if (!placement || !measure) continue;
      const box = placement.box;

      const selected = options.selectedMeasureIds?.has(measure.id) ?? false;

      ctx.fillStyle = selected ? options.theme.noteSelected : options.theme.foreground;
      ctx.font = selected ? GUTTER_FONT_SELECTED : GUTTER_FONT;
      // `measure.index` is 0-based; measure numbers are 1-based.
      ctx.fillText(String(measure.index + 1), box.x + GUTTER_TEXT_INSET, baselineY);
    }

    ctx.fillStyle = previousFill;
    ctx.font = previousFont;
  }

  dispose(): void {
    this.cache = null;
  }
}
