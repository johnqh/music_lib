import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Accidental, StaveNote, Voice } from 'vexflow';
import { applyHighlights, buildTies, VexFlowScoreRenderer } from './renderer';
import type { Channel } from './renderer';
import { buildVoiceContent, keySignatureToVexSpec } from './convert';
import type { NoteMeta } from './convert';
import type { RenderOptions, RenderTheme } from './types';
import type { KeySignature, NoteEvent, Pitch } from '@sudobility/music_types';
import { allNotes } from '../../domain/score/queries';
import { ticksFor } from '../../domain/time/ticks';
import { chordScore, twinkleScore, twoTrackScore } from '../../test/fixtures';

// rgb(...) form (not hex): jsdom's CSSOM normalizes any color assigned to
// `.style.fill`/`.style.stroke` to this form when read back, so tests that
// compare against `theme.*` directly need the constant already in that form.
const theme: RenderTheme = {
  foreground: 'rgb(17, 17, 17)',
  selection: 'rgb(0, 102, 255)',
  playback: 'rgb(255, 102, 0)',
  preview: 'rgb(153, 153, 153)',
};

function options(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return { zoom: 1, layoutMode: 'page', width: 900, theme, ...overrides };
}

// NOTE on the two tests below: `paintDescendants` (renderer.ts) recolors
// most glyph paths (e.g. a notehead) purely via SVG *inheritance* — it sets
// `style.fill`/`style.stroke` on the note's own `<g>` group (the value
// returned in `idToElement`), which cascades down to child paths that carry
// no `fill`/`stroke` attribute of their own (VexFlow's SVG backend omits an
// attribute that would just duplicate its enclosing group's value). jsdom
// does not implement CSS inheritance computation (`getComputedStyle` on an
// SVG child won't reflect an ancestor's inline style), so these tests
// assert on the *group* element's own inline style — the actual mechanism —
// rather than trying to read a (jsdom-unsupported) computed/inherited value
// off a child shape.

let container: HTMLDivElement;
let renderer: VexFlowScoreRenderer;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  renderer = new VexFlowScoreRenderer();
});

afterEach(() => {
  renderer.dispose();
  container.remove();
});

describe('VexFlowScoreRenderer.render', () => {
  it('renders a note group for every note event in a single-voice melody', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());

    const notes = allNotes(score);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      const element = result.idToElement.get(note.id);
      expect(element, `missing element for note ${note.id}`).toBeDefined();
      expect(element?.classList.contains('vf-stavenote')).toBe(true);
      expect(container.querySelector(`[id="vf-${note.id}"]`)).toBe(element);
    }
  });

  it('produces exactly one drawn note group for a chord, shared by every chord member id', () => {
    const score = chordScore();
    const result = renderer.render(score, container, options());

    const firstMeasure = score.tracks[0].measures[0];
    const chordEventIds = firstMeasure.voices[0].events.map((e) => e.id);
    expect(chordEventIds.length).toBeGreaterThan(1);

    const elements = chordEventIds.map((id) => result.idToElement.get(id));
    expect(elements.every((el) => el !== undefined)).toBe(true);
    expect(new Set(elements).size).toBe(1);

    const staveNoteGroups = container.querySelectorAll('.vf-stavenote');
    // 4 chord measures, one StaveNote group per measure.
    expect(staveNoteGroups.length).toBe(firstMeasure.durationTicks > 0 ? score.tracks[0].measures.length : 0);
  });

  it('maps every rendered measure id to a bounding box', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    for (const measure of score.tracks[0].measures) {
      expect(result.measureIdToBBox.has(measure.id)).toBe(true);
    }
  });

  it('renders a stave per track for a multi-track score', () => {
    const score = twoTrackScore();
    renderer.render(score, container, options());
    const staveGroups = container.querySelectorAll('.vf-stave');
    const expectedStaveCount = score.tracks.reduce((sum, t) => sum + t.measures.length, 0);
    expect(staveGroups.length).toBe(expectedStaveCount);
  });

  it('draws a brace connector for a multi-track score (extra <path>s versus the sum of each track alone)', () => {
    // StaveConnector draws raw path/fill/stroke calls (no wrapping
    // group/class of its own, unlike Stave/StaveNote), so assert its effect
    // indirectly: rendering both tracks together must produce strictly more
    // <path> elements than rendering each track alone and summing, since
    // the shared content is otherwise identical and the connector is pure
    // addition.
    const score = twoTrackScore();

    const countFor = (trackIds: string[]): number => {
      const scratch = document.createElement('div');
      document.body.appendChild(scratch);
      const r = new VexFlowScoreRenderer();
      r.render(score, scratch, options({ trackIds }));
      const count = scratch.querySelectorAll('path').length;
      r.dispose();
      scratch.remove();
      return count;
    };

    const soloCounts = score.tracks.map((t) => countFor([t.id]));
    const combinedCount = countFor(score.tracks.map((t) => t.id));

    expect(combinedCount).toBeGreaterThan(soloCounts.reduce((a, b) => a + b, 0));
  });

  it('honors trackIds filtering', () => {
    const score = twoTrackScore();
    const [treble, bass] = score.tracks;
    renderer.render(score, container, options({ trackIds: [treble.id] }));
    const staveGroups = container.querySelectorAll('.vf-stave');
    expect(staveGroups.length).toBe(treble.measures.length);
    void bass;
  });

  describe('visibleMeasureIndices (spec §26/§29 virtualization)', () => {
    it('draws staves/notes only for measures in the set, and omits the rest from every RenderResult map', () => {
      const score = twinkleScore(); // 8 measures
      const visible = new Set([2, 3]);
      const result = renderer.render(score, container, options({ visibleMeasureIndices: visible }));

      const staveGroups = container.querySelectorAll('.vf-stave');
      expect(staveGroups.length).toBe(visible.size);

      score.tracks[0].measures.forEach((measure, index) => {
        expect(result.measureIdToBBox.has(measure.id)).toBe(visible.has(index));
      });
      for (const note of allNotes(score)) {
        const owningMeasure = score.tracks[0].measures.find((m) =>
          m.voices.some((v) => v.events.some((e) => e.id === note.id)),
        )!;
        const owningIndex = score.tracks[0].measures.indexOf(owningMeasure);
        expect(result.idToElement.has(note.id)).toBe(visible.has(owningIndex));
      }
    });

    it('renders every measure when omitted (matches pre-virtualization behavior)', () => {
      const score = twinkleScore();
      const result = renderer.render(score, container, options());
      expect(result.measureIdToBBox.size).toBe(score.tracks[0].measures.length);
    });

    it('leaves the canvas sized from the full layout even when most measures are culled', () => {
      const score = twinkleScore();
      const full = renderer.render(score, container, options());
      const fullWidth = container.querySelector('svg')!.getAttribute('width');
      const fullHeight = container.querySelector('svg')!.getAttribute('height');

      const culled = renderer.render(score, container, options({ visibleMeasureIndices: new Set([0]) }));
      const culledWidth = container.querySelector('svg')!.getAttribute('width');
      const culledHeight = container.querySelector('svg')!.getAttribute('height');

      expect(culledWidth).toBe(fullWidth);
      expect(culledHeight).toBe(fullHeight);
      void full;
      void culled;
    });

    it('draws nothing for an empty visible set (still sizes the canvas)', () => {
      const score = twinkleScore();
      const result = renderer.render(score, container, options({ visibleMeasureIndices: new Set() }));
      expect(container.querySelectorAll('.vf-stave')).toHaveLength(0);
      expect(result.idToElement.size).toBe(0);
      expect(result.measureIdToBBox.size).toBe(0);
      expect(container.querySelector('svg')).not.toBeNull();
    });
  });

  it('returns a positive height', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    expect(result.height).toBeGreaterThan(0);
  });
});

describe('VexFlowScoreRenderer.update', () => {
  it('re-renders without leaking previous SVG content', () => {
    const score = twinkleScore();
    renderer.render(score, container, options());
    const svgCountAfterFirstRender = container.querySelectorAll('svg').length;
    const childCountAfterFirstRender = container.childElementCount;

    const result = renderer.render(score, container, options());
    renderer.update(score, 'all', container, result);

    expect(container.querySelectorAll('svg').length).toBe(svgCountAfterFirstRender);
    expect(container.childElementCount).toBe(childCountAfterFirstRender);
  });

  it('produces a fresh, structurally-equivalent result', () => {
    const score = twinkleScore();
    const first = renderer.render(score, container, options());
    const updated = renderer.update(score, { dirtyMeasureIds: [score.tracks[0].measures[0].id] }, container, first);
    expect(updated.idToElement.size).toBe(first.idToElement.size);
  });

  it('throws if called before render()', () => {
    const score = twinkleScore();
    const fresh = new VexFlowScoreRenderer();
    const emptyResult = { idToElement: new Map(), idToBBox: new Map(), measureIdToBBox: new Map(), height: 0, theme };
    expect(() => fresh.update(score, 'all', container, emptyResult)).toThrow();
  });
});

describe('VexFlowScoreRenderer.dispose', () => {
  it('clears the container', () => {
    const score = twinkleScore();
    renderer.render(score, container, options());
    expect(container.childElementCount).toBeGreaterThan(0);
    renderer.dispose();
    expect(container.childElementCount).toBe(0);
  });
});

describe('applyHighlights', () => {
  it('toggles selected/playing/preview classes and clears them on the next call', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    const [a, b, c] = allNotes(score);

    applyHighlights(result, { selectedIds: [a.id], playingIds: [b.id], previewIds: [c.id] });
    expect(result.idToElement.get(a.id)?.classList.contains('selected')).toBe(true);
    expect(result.idToElement.get(b.id)?.classList.contains('playing')).toBe(true);
    expect(result.idToElement.get(c.id)?.classList.contains('preview')).toBe(true);

    applyHighlights(result, { selectedIds: [], playingIds: [], previewIds: [] });
    expect(result.idToElement.get(a.id)?.classList.contains('selected')).toBe(false);
    expect(result.idToElement.get(b.id)?.classList.contains('playing')).toBe(false);
    expect(result.idToElement.get(c.id)?.classList.contains('preview')).toBe(false);
  });

  it('ignores unknown ids without throwing', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    expect(() => applyHighlights(result, { selectedIds: ['nope'], playingIds: [], previewIds: [] })).not.toThrow();
  });

  describe('shape+color highlight cue (spec §27: not color alone)', () => {
    it('gives selected/playing/preview each a distinct outline style, not just a color', () => {
      const score = twinkleScore();
      const result = renderer.render(score, container, options());
      const [a, b, c] = allNotes(score);

      applyHighlights(result, { selectedIds: [a.id], playingIds: [b.id], previewIds: [c.id] });

      const selectedEl = result.idToElement.get(a.id)!;
      const playingEl = result.idToElement.get(b.id)!;
      const previewEl = result.idToElement.get(c.id)!;

      // jsdom's CSSOM doesn't decompose the `outline` shorthand into
      // longhands (`style.outlineStyle` stays empty even after setting
      // `style.outline`), so these assert against the raw shorthand string.
      expect(selectedEl.style.outline).toContain('solid');
      expect(playingEl.style.outline).toContain('dashed');
      expect(previewEl.style.outline).toContain('dotted');

      // Every one of the three outline styles differs from the other two -
      // this is the actual "not color alone" guarantee, independent of
      // which colors the theme happens to use.
      const styles = [selectedEl.style.outline, playingEl.style.outline, previewEl.style.outline];
      expect(new Set(styles).size).toBe(3);
    });

    it('clears the outline on un-highlight', () => {
      const score = twinkleScore();
      const result = renderer.render(score, container, options());
      const [a] = allNotes(score);
      const element = result.idToElement.get(a.id)!;

      applyHighlights(result, { selectedIds: [a.id], playingIds: [], previewIds: [] });
      expect(element.style.outline).toContain('solid');

      applyHighlights(result, { selectedIds: [], playingIds: [], previewIds: [] });
      expect(element.style.outline).toBe('none');
    });
  });

  it('paints highlighted notes with theme colors and restores the base foreground on un-highlight (finding 2)', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    const [a] = allNotes(score);
    const element = result.idToElement.get(a.id);
    expect(element).toBeDefined();

    applyHighlights(result, { selectedIds: [a.id], playingIds: [], previewIds: [] });
    expect(element?.style.fill).toBe(theme.selection);
    expect(element?.style.stroke).toBe(theme.selection);

    applyHighlights(result, { selectedIds: [], playingIds: [], previewIds: [] });
    expect(element?.style.fill).toBe(theme.foreground);
    expect(element?.style.stroke).toBe(theme.foreground);
  });

  it("carries the render's theme on the result for applyHighlights to use", () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    expect(result.theme).toBe(theme);
  });
});

describe('base notation theming (finding 2)', () => {
  it('paints the whole render with the theme foreground, not VexFlow default black', () => {
    // render() sets the ambient fill/stroke on the <svg> root itself, which
    // every glyph without its own fill/stroke attribute inherits (see
    // paintDescendants's doc) — this is the directly-observable effect in
    // jsdom (which doesn't compute real CSS inheritance for descendants).
    const score = twinkleScore();
    renderer.render(score, container, options());
    const svg = container.querySelector('svg');
    expect(svg?.style.fill).toBe(theme.foreground);
    expect(svg?.style.stroke).toBe(theme.foreground);
  });

  it('overrides an explicitly-colored descendant (e.g. a ledger line) directly, not just via inheritance', () => {
    // Twinkle's melody dips below the staff (e.g. a low C), which draws a
    // ledger line — a path VexFlow explicitly strokes with its own color
    // attribute (breaking inheritance from the <svg> root), so it must be
    // repainted directly rather than relying on the ambient fill/stroke.
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    const [a] = allNotes(score);
    const element = result.idToElement.get(a.id)!;
    const explicitlyStroked = Array.from(element.querySelectorAll<SVGElement>('path')).find((el) => {
      const strokeAttr = el.getAttribute('stroke');
      return strokeAttr !== null && strokeAttr !== 'none';
    });
    expect(explicitlyStroked).toBeDefined();
    expect(explicitlyStroked?.style.stroke).toBe(theme.foreground);
  });
});

describe('zoom (finding 4)', () => {
  it('scales the reported height roughly proportionally with zoom, holding layout (system count) fixed', () => {
    // Continuous mode keeps every measure in one system regardless of zoom
    // (layout.ts divides the *page-mode* width budget by zoom; continuous
    // mode ignores width entirely), so the only source of height
    // difference between these two renders is the zoom scale itself, not a
    // different number of systems.
    const score = twinkleScore();
    const atZoom1 = new VexFlowScoreRenderer();
    const c1 = document.createElement('div');
    document.body.appendChild(c1);
    const r1 = atZoom1.render(score, c1, options({ zoom: 1, layoutMode: 'continuous' }));

    const atZoom2 = new VexFlowScoreRenderer();
    const c2 = document.createElement('div');
    document.body.appendChild(c2);
    const r2 = atZoom2.render(score, c2, options({ zoom: 2, layoutMode: 'continuous' }));

    expect(r2.height).toBeGreaterThan(r1.height * 1.8);
    expect(r2.height).toBeLessThan(r1.height * 2.2);

    atZoom1.dispose();
    atZoom2.dispose();
    c1.remove();
    c2.remove();
  });

  it('applies an SVG viewBox scale (context.scale) rather than only stretching layout spacing', () => {
    const score = twinkleScore();
    renderer.render(score, container, options({ zoom: 2 }));
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBeTruthy();
    const [, , vbWidth] = (svg?.getAttribute('viewBox') ?? '').split(' ').map(Number);
    const svgWidth = Number(svg?.getAttribute('width'));
    // viewBox width (logical) should be roughly half the <svg> width (screen
    // pixels) at zoom 2 — i.e. the viewBox, not per-metric multiplication,
    // is what's carrying the zoom factor.
    expect(vbWidth).toBeGreaterThan(0);
    expect(svgWidth / vbWidth).toBeGreaterThan(1.8);
    expect(svgWidth / vbWidth).toBeLessThan(2.2);
  });
});

function pitch(step: Pitch['step'], accidental: Pitch['accidental'], octave: number): Pitch {
  return { step, accidental, octave };
}

/** A single-note (non-chord) channel entry, built the same way renderer.ts does. */
function channelEntryFor(events: NoteEvent[]): { note: StaveNote; meta: NoteMeta } {
  const { notes, metas } = buildVoiceContent(events, 480);
  return { note: notes[0], meta: metas[0] };
}

describe('buildTies (finding 1: pitch-matched chord ties, not array adjacency)', () => {
  it('ties only the one chord member that actually ties forward, on the correct key indices', () => {
    const quarter = ticksFor('quarter', 480);
    // Measure 1 chord: C4 (ties forward), E4 (does not), G4 (does not).
    const chordA = channelEntryFor([
      { id: 'a-c', pitch: pitch('C', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't', tieStart: true },
      { id: 'a-e', pitch: pitch('E', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
      { id: 'a-g', pitch: pitch('G', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ]);
    // Measure 2 chord: C4 (receives the tie), F4, A4 — different pitches
    // than measure 1's E4/G4, and NOT flagged tieStop, so array-index
    // matching (old behavior) would have wrongly tied E4->F4 and G4->A4
    // too, on top of getting C4 right only by coincidence of index 0.
    const chordB = channelEntryFor([
      { id: 'b-c', pitch: pitch('C', 0, 4), startTick: quarter, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't', tieStop: true },
      { id: 'b-f', pitch: pitch('F', 0, 4), startTick: quarter, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
      { id: 'b-a', pitch: pitch('A', 0, 4), startTick: quarter, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ]);
    const channel: Channel = [chordA, chordB];

    const ties = buildTies(channel);
    expect(ties).toHaveLength(1);
    const { first_indices, last_indices } = ties[0].getNotes();
    expect(first_indices).toEqual([0]); // C4 is index 0 in chordA's keys
    expect(last_indices).toEqual([0]); // C4 is index 0 in chordB's keys too (coincidentally), but chosen by pitch match
  });

  it('produces no tie when the flagged pitches do not actually match between the two notes', () => {
    const quarter = ticksFor('quarter', 480);
    const a = channelEntryFor([
      { id: 'a', pitch: pitch('C', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't', tieStart: true },
    ]);
    // tieStop is set, but the pitch is different (D4 vs C4) — e.g. corrupt
    // data, or two coincidentally-adjacent unrelated notes; must not tie.
    const b = channelEntryFor([
      { id: 'b', pitch: pitch('D', 0, 4), startTick: quarter, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't', tieStop: true },
    ]);
    const ties = buildTies([a, b]);
    expect(ties).toHaveLength(0);
  });

  it('ties every matching member of an all-tied chord (all pitches identical)', () => {
    const half = ticksFor('half', 480);
    const a = channelEntryFor([
      { id: 'a-c', pitch: pitch('C', 0, 4), startTick: 0, durationTicks: half, velocity: 80, voiceId: 'v', trackId: 't', tieStart: true },
      { id: 'a-e', pitch: pitch('E', 0, 4), startTick: 0, durationTicks: half, velocity: 80, voiceId: 'v', trackId: 't', tieStart: true },
    ]);
    const b = channelEntryFor([
      { id: 'b-c', pitch: pitch('C', 0, 4), startTick: half, durationTicks: half, velocity: 80, voiceId: 'v', trackId: 't', tieStop: true },
      { id: 'b-e', pitch: pitch('E', 0, 4), startTick: half, durationTicks: half, velocity: 80, voiceId: 'v', trackId: 't', tieStop: true },
    ]);
    const ties = buildTies([a, b]);
    expect(ties).toHaveLength(1);
    const { first_indices, last_indices } = ties[0].getNotes();
    expect(first_indices).toEqual([0, 1]);
    expect(last_indices).toEqual([0, 1]);
  });
});

describe('key-signature-aware accidentals (finding 3)', () => {
  /** Mirrors exactly what renderer.ts's buildMeasureContent does: build notes, then let VexFlow decide accidental glyphs from the key signature. */
  function accidentalCategoriesFor(events: NoteEvent[], keySignature: KeySignature): string[][] {
    const { notes } = buildVoiceContent(events, 480);
    const voice = new Voice({ num_beats: 4, beat_value: 4 }).setMode(Voice.Mode.SOFT);
    voice.addTickables(notes);
    Accidental.applyAccidentals([voice], keySignatureToVexSpec(keySignature));
    return notes.map((n) => n.getModifiers().filter((m) => m.getCategory() === 'Accidental').map(() => 'Accidental'));
  }

  const quarter = ticksFor('quarter', 480);
  const gMajor: KeySignature = { fifths: 1, mode: 'major' };
  const cMajor: KeySignature = { fifths: 0, mode: 'major' };

  it('draws no accidental for an F# in G major (implied by the key signature)', () => {
    const events: NoteEvent[] = [
      { id: 'n', pitch: pitch('F', 1, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ];
    const [categories] = accidentalCategoriesFor(events, gMajor);
    expect(categories).toEqual([]);
  });

  it('draws a natural sign for an F-natural in G major (contradicts the key signature)', () => {
    const events: NoteEvent[] = [
      { id: 'n', pitch: pitch('F', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ];
    const [categories] = accidentalCategoriesFor(events, gMajor);
    expect(categories).toEqual(['Accidental']);
  });

  it('draws an accidental for a chromatic note in C major', () => {
    const events: NoteEvent[] = [
      { id: 'n', pitch: pitch('C', 1, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ];
    const [categories] = accidentalCategoriesFor(events, cMajor);
    expect(categories).toEqual(['Accidental']);
  });

  it('draws no accidental for an in-key natural note in C major', () => {
    const events: NoteEvent[] = [
      { id: 'n', pitch: pitch('D', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ];
    const [categories] = accidentalCategoriesFor(events, cMajor);
    expect(categories).toEqual([]);
  });
});
