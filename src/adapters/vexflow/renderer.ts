/**
 * VexFlow `ScoreRenderer` implementation (spec §7, §26): orchestrates
 * `layout.ts` (system/stave positions) and `convert.ts` (musical content)
 * into an actual VexFlow SVG draw, then `id-map.ts` to build the returned
 * id maps. Also exports `applyHighlights`, the caller-side helper for
 * painting selection/playback/preview state onto a `RenderResult`.
 *
 * Pure DOM adapter: no store/React imports (spec §3, §37).
 */
import { Accidental, Beam, Formatter, Renderer as VexRenderer, Stave, StaveConnector, StaveTie, Voice } from 'vexflow';
import type { StaveNote } from 'vexflow';
import type { KeySignature, Measure, Score, TimeSignature, Track } from '@sudobility/music_types';
import { buildVoiceContent, keySignatureToVexSpec, pitchToVexKey } from './convert.js';
import type { NoteMeta } from './convert.js';
import { buildEventMaps, buildMeasureMap } from './id-map.js';
import { computeLayout, resolveZoom } from './layout.js';
import type { MeasureLayout } from './layout.js';
import type { RenderOptions, RenderResult, ScoreChangeSet, ScoreRenderer } from './types.js';

function sameTimeSignature(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function sameKeySignature(a: KeySignature, b: KeySignature): boolean {
  return a.fifths === b.fifths && a.mode === b.mode;
}

/** A single note/rest "channel" (spec §25 voice-ordinal convention, mirrored from `domain/score/ties.ts`) accumulated across a track's measures, for cross-measure/cross-decomposition tie detection. */
export type Channel = Array<{ note: StaveNote; meta: NoteMeta }>;

/** Builds one measure's `Stave`, its VexFlow `Voice`s, and its beams; records notes into `channels` for tie building. */
function buildMeasureContent(
  measure: Measure,
  track: Track,
  placement: MeasureLayout,
  prevMeasure: Measure | undefined,
  ppq: number,
  channels: Map<number, Channel>,
  allMetas: NoteMeta[],
): { stave: Stave; voices: Voice[]; beams: Beam[] } {
  const { box, isFirstInSystem } = placement;
  const stave = new Stave(box.x, box.y, box.width);
  stave.setAttribute('id', measure.id);

  if (isFirstInSystem) {
    stave.addClef(track.clef);
  }
  if (isFirstInSystem || !prevMeasure || !sameKeySignature(prevMeasure.keySignature, measure.keySignature)) {
    stave.addKeySignature(keySignatureToVexSpec(measure.keySignature));
  }
  if (!prevMeasure || !sameTimeSignature(prevMeasure.timeSignature, measure.timeSignature)) {
    stave.addTimeSignature(`${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`);
  }

  const voices: Voice[] = [];
  const beams: Beam[] = [];

  measure.voices.forEach((domainVoice, voiceOrdinal) => {
    const { notes, metas } = buildVoiceContent(domainVoice.events, ppq);
    if (notes.length === 0) return;

    const vexVoice = new Voice({
      num_beats: measure.timeSignature.numerator,
      beat_value: measure.timeSignature.denominator,
    });
    // SOFT mode: don't throw if a voice's summed ticks don't exactly match
    // the time signature (e.g. the decomposeDuration nearest-duration
    // fallback for a non-standard remainder can be off by a few ticks).
    vexVoice.setMode(Voice.Mode.SOFT);
    vexVoice.addTickables(notes);
    voices.push(vexVoice);
    beams.push(...Beam.generateBeams(notes));

    const channel = channels.get(voiceOrdinal) ?? [];
    notes.forEach((note, i) => channel.push({ note, meta: metas[i] }));
    channels.set(voiceOrdinal, channel);
    allMetas.push(...metas);
  });

  // Accidental *glyphs* are decided here, once per measure, across every
  // voice on this stave — never unconditionally per note (see convert.ts):
  // VexFlow's own key-signature-and-context-aware logic decides whether a
  // sharp/flat/natural is actually needed (e.g. no redundant accidental on
  // an in-key F# in G major), reading each note's spelling straight out of
  // the `keys` string `convert.ts` already built.
  if (voices.length > 0) {
    Accidental.applyAccidentals(voices, keySignatureToVexSpec(measure.keySignature));
  }

  return { stave, voices, beams };
}

/**
 * Ties every adjacent pair of notes in a voice-ordinal channel whose keys
 * actually match by pitch — covers both cross-barline ties and same-measure
 * duration-decomposition ties with one mechanism. Matches by pitch, never
 * by array index/adjacency (a chord where only one of several members ties
 * forward must produce exactly one `StaveTie`, on the correct key indices
 * on each side — see `KeyTie`'s doc in convert.ts and
 * `domain/score/ties.ts`'s `findForwardPartner`/`findBackwardPartner`,
 * which requires the same tick/pitch/tie-flag matching for the same
 * reason: a same-tick note sharing a channel by coincidence must not be
 * spliced in).
 */
export function buildTies(channel: Channel): StaveTie[] {
  const ties: StaveTie[] = [];
  for (let i = 0; i < channel.length - 1; i += 1) {
    const a = channel[i];
    const b = channel[i + 1];
    if (a.meta.isRest || b.meta.isRest || !a.meta.tieStart || !b.meta.tieStop) continue;

    const firstIndices: number[] = [];
    const lastIndices: number[] = [];
    const usedB = new Set<number>();
    a.meta.keyTies.forEach((aKey, aIndex) => {
      if (!aKey.tieStart) return;
      const aSpelling = pitchToVexKey(aKey.pitch);
      const bIndex = b.meta.keyTies.findIndex(
        (bKey, idx) => !usedB.has(idx) && bKey.tieStop && pitchToVexKey(bKey.pitch) === aSpelling,
      );
      if (bIndex === -1) return;
      usedB.add(bIndex);
      firstIndices.push(aIndex);
      lastIndices.push(bIndex);
    });

    if (firstIndices.length === 0) continue;
    ties.push(new StaveTie({ first_note: a.note, last_note: b.note, first_indices: firstIndices, last_indices: lastIndices }));
  }
  return ties;
}

export class VexFlowScoreRenderer implements ScoreRenderer {
  private lastOptions: RenderOptions | undefined;
  private lastContainer: HTMLElement | undefined;

  render(score: Score, container: HTMLElement, options: RenderOptions): RenderResult {
    this.lastOptions = options;
    this.lastContainer = container;

    // VexFlow's SVGContext appends a fresh <svg> to the container on every
    // construction rather than clearing it first — without this, repeated
    // render()/update() calls would stack up duplicate <svg> elements.
    container.replaceChildren();

    const zoom = resolveZoom(options.zoom);
    const plan = computeLayout(score, options);
    // `plan.totalWidth`/`totalHeight` are LOGICAL (unscaled) units — see
    // layout.ts. The <svg>'s own width/height attributes must be the final
    // on-screen size, so those are the zoom-scaled values; `ctx.scale`
    // below (a viewBox scale) then maps the logical coordinate space every
    // draw call below uses onto that on-screen size, so glyphs/text scale
    // uniformly with spacing instead of staying a fixed size while only the
    // layout stretches.
    const scaledWidth = Math.max(1, Math.ceil(plan.totalWidth * zoom));
    const scaledHeight = Math.max(1, Math.ceil(plan.totalHeight * zoom));
    // VexFlow's typings require HTMLDivElement specifically (legacy DOM
    // props like `align`); our contract takes the broader HTMLElement
    // (spec §26), and VexFlow only actually requires a plain container to
    // append an <svg> into, so the cast is safe.
    const vexRenderer = new VexRenderer(container as HTMLDivElement, VexRenderer.Backends.SVG);
    vexRenderer.resize(scaledWidth, scaledHeight);
    const ctx = vexRenderer.getContext();
    ctx.scale(zoom, zoom);

    const allMetas: NoteMeta[] = [];
    const allMeasureIds: string[] = [];
    const staves: Stave[] = [];
    const voicesToDraw: Voice[] = [];
    const beamsToDraw: Beam[] = [];
    const tiesToDraw: StaveTie[] = [];
    /** trackId -> measureIndex -> its drawn Stave, for connector placement. */
    const staveByTrackMeasure = new Map<string, Map<number, Stave>>();

    const visibleMeasureIndices = options.visibleMeasureIndices;

    plan.trackLayouts.forEach(({ track, measures }) => {
      const channels = new Map<number, Channel>();
      staveByTrackMeasure.set(track.id, new Map());

      measures.forEach((placement) => {
        // Virtualization (spec §26/§29): a measure outside the visible set
        // is skipped entirely — no stave, no voice/note content, no
        // `RenderResult` entries — leaving its already-reserved layout
        // space (from the full, uncalled `plan`) blank. See
        // `RenderOptions.visibleMeasureIndices`'s doc comment.
        if (visibleMeasureIndices && !visibleMeasureIndices.has(placement.measureIndex)) return;

        const measure = track.measures[placement.measureIndex];
        const prevMeasure = track.measures[placement.measureIndex - 1];
        allMeasureIds.push(measure.id);

        const { stave, voices, beams } = buildMeasureContent(
          measure,
          track,
          placement,
          prevMeasure,
          score.ppq,
          channels,
          allMetas,
        );
        stave.setContext(ctx);
        stave.format();
        staveByTrackMeasure.get(track.id)!.set(placement.measureIndex, stave);
        staves.push(stave);
        beamsToDraw.push(...beams);

        if (voices.length > 0) {
          voices.forEach((v) => v.setStave(stave));
          const formatter = new Formatter();
          formatter.joinVoices(voices);
          const justifyWidth = Math.max(20, stave.getNoteEndX() - stave.getNoteStartX());
          formatter.format(voices, justifyWidth);
          voicesToDraw.push(...voices);
        }
      });

      for (const channel of channels.values()) {
        tiesToDraw.push(...buildTies(channel));
      }
    });

    // Draw order: staves, then notes/voices, then beams/ties/connectors on top.
    staves.forEach((s) => s.draw());
    voicesToDraw.forEach((v) => v.draw(ctx));
    beamsToDraw.forEach((b) => {
      b.setContext(ctx);
      b.draw();
    });
    tiesToDraw.forEach((t) => {
      t.setContext(ctx);
      t.draw();
    });

    if (plan.tracks.length > 1) {
      plan.systems.forEach((system) => {
        const firstMeasureIndex = system.measureIndices[0];
        const topStave = staveByTrackMeasure.get(plan.tracks[0].id)?.get(firstMeasureIndex);
        const bottomStave = staveByTrackMeasure
          .get(plan.tracks[plan.tracks.length - 1].id)
          ?.get(firstMeasureIndex);
        if (!topStave || !bottomStave || topStave === bottomStave) return;
        const connector = new StaveConnector(topStave, bottomStave);
        connector.setType('brace');
        connector.setContext(ctx);
        connector.draw();
      });
    }

    // Paint the whole drawn notation with the theme's foreground color.
    // VexFlow draws in black by default (each shape's own `fill`/`stroke`
    // presentation attribute — see `paintDescendants`'s doc), which would
    // stay black-on-dark under a dark theme if left alone. Every element
    // `applyHighlights` later un-highlights is reset back to this same
    // foreground (not removed/cleared), so notation never reverts to
    // VexFlow's default black.
    const svgRoot = container.querySelector('svg');
    if (svgRoot) paintDescendants(svgRoot, options.theme.foreground);

    const { idToElement, idToBBox } = buildEventMaps(container, allMetas, zoom);
    const measureIdToBBox = buildMeasureMap(container, allMeasureIds, zoom);

    return { idToElement, idToBBox, measureIdToBBox, height: scaledHeight, theme: options.theme };
  }

  update(score: Score, _changes: ScoreChangeSet, container: HTMLElement, _previous: RenderResult): RenderResult {
    // MVP: always a full re-render (O(score) — proportional to total note
    // count, same cost as `render`), regardless of `_changes`. The
    // `ScoreChangeSet` shape (`"all"` | `{ dirtyMeasureIds }`) is kept in
    // the contract so a future incremental implementation (re-layout/redraw
    // only the systems containing `dirtyMeasureIds`, reusing unaffected
    // staves from `_previous`) can slot in without changing callers.
    void _previous;
    if (!this.lastOptions) {
      throw new Error('VexFlowScoreRenderer.update() called before render()');
    }
    return this.render(score, container, this.lastOptions);
  }

  dispose(): void {
    this.lastContainer?.replaceChildren();
    this.lastContainer = undefined;
    this.lastOptions = undefined;
  }
}

export type HighlightSets = { selectedIds: string[]; playingIds: string[]; previewIds: string[] };

const HIGHLIGHT_CLASSES = ['selected', 'playing', 'preview'] as const;
const PAINTED_DESCENDANTS_SELECTOR = 'path, rect, ellipse, circle, polygon, polyline, line, text';

/**
 * Recolors `root` and every shape descendant to `color`, in two parts:
 *
 * 1. **Ambient**: sets inline `style.fill`/`style.stroke` on `root` itself.
 *    VexFlow's SVG backend skips writing a `fill`/`stroke` attribute on a
 *    shape when it would just duplicate the value already applied to its
 *    enclosing group, relying on ordinary SVG inheritance instead
 *    (`SVGContext.applyAttributes` diffs against `groupAttributes`) — so
 *    most glyph paths (e.g. a notehead) carry *no* `fill` attribute of
 *    their own at all, and would never be touched by an attribute-presence
 *    check. Setting `root`'s inline style gives every such descendant a
 *    color to inherit. This is also what makes per-element highlighting
 *    work: painting a single note's `<g class="vf-stavenote">` ambiently
 *    recolors its notehead via the same inheritance path.
 *
 * 2. **Override**: every descendant that has its *own* explicit `fill`/
 *    `stroke` presentation attribute breaks that inheritance chain and
 *    must be repainted directly (inline `style` always wins over the same
 *    element's presentation attribute, regardless of value) — e.g. a
 *    ledger line explicitly stroked `"#444"`. Never touch a property the
 *    shape explicitly declared `"none"` (VexFlow always declares whichever
 *    of `fill`/`stroke` a given shape doesn't use as `"none"` on itself —
 *    see `SVGContext.fill`/`.stroke`): doing so would turn a glyph's
 *    `stroke="none"` into a visible outline, or fill in an open tie/slur
 *    curve's implicit closing segment.
 */
function paintDescendants(root: SVGElement, color: string): void {
  root.style.fill = color;
  root.style.stroke = color;

  for (const target of root.querySelectorAll<SVGElement>(PAINTED_DESCENDANTS_SELECTOR)) {
    const fillAttr = target.getAttribute('fill');
    if (fillAttr !== null && fillAttr !== 'none') target.style.fill = color;
    const strokeAttr = target.getAttribute('stroke');
    if (strokeAttr !== null && strokeAttr !== 'none') target.style.stroke = color;
  }
}

/**
 * CSS `outline` style per highlight kind (spec §27: "Do not rely on color
 * alone for selection or errors") — a shape/pattern cue distinct from
 * `paintDescendants`'s fill/stroke color change, so a colorblind user (or
 * anyone in a low-color-contrast viewing condition) still has a non-color
 * signal for which notes are selected/playing/previewed. `outline` (not a
 * new SVG shape/`stroke-width` bump) is used deliberately: it draws around
 * an element's own bounding box with no bbox math or extra DOM nodes
 * needed here, doesn't affect layout, and is independent of whatever
 * fill/stroke attributes a given glyph happens to declare (unlike
 * `paintDescendants`'s stroke recoloring, which explicitly skips any
 * descendant declaring `stroke="none"` — most notehead glyphs, in
 * practice, per that function's own doc comment).
 */
const HIGHLIGHT_OUTLINE_STYLE: Record<(typeof HIGHLIGHT_CLASSES)[number], string> = {
  selected: 'solid',
  playing: 'dashed',
  preview: 'dotted',
};

function paint(result: RenderResult, id: string, cls: (typeof HIGHLIGHT_CLASSES)[number], color: string): void {
  const element = result.idToElement.get(id);
  if (!element) return;
  element.classList.add(cls);
  paintDescendants(element, color);
  element.style.outline = `2px ${HIGHLIGHT_OUTLINE_STYLE[cls]} ${color}`;
  element.style.outlineOffset = '1px';
}

/**
 * Sets/clears `.selected` / `.playing` / `.preview` classes, fill/stroke
 * colors (from `result.theme`), and a distinct-per-kind CSS outline (see
 * `HIGHLIGHT_OUTLINE_STYLE`) on the elements in `result.idToElement` named
 * by `highlights`. Every previously-painted element is reset first — fill/
 * stroke back to `result.theme.foreground` (the color the base notation
 * was drawn with, not VexFlow's default black/removed-property) and the
 * outline cleared entirely — so calling this again with a smaller/
 * different set correctly un-highlights whatever fell out without ever
 * reverting to an untheme color or leaving a stale outline. When an id
 * appears in more than one set, `playing` wins over `selected`, which wins
 * over `preview` (applied in that order, last wins, for both the color and
 * the outline).
 */
export function applyHighlights(result: RenderResult, highlights: HighlightSets): void {
  for (const element of result.idToElement.values()) {
    for (const cls of HIGHLIGHT_CLASSES) element.classList.remove(cls);
    paintDescendants(element, result.theme.foreground);
    element.style.outline = 'none';
    element.style.outlineOffset = '';
  }

  for (const id of highlights.previewIds) paint(result, id, 'preview', result.theme.preview);
  for (const id of highlights.selectedIds) paint(result, id, 'selected', result.theme.selection);
  for (const id of highlights.playingIds) paint(result, id, 'playing', result.theme.playback);
}
