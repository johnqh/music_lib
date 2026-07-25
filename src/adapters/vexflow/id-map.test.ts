import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Formatter, Renderer, Stave, StaveNote } from 'vexflow';
import { buildEventMaps, buildMeasureMap } from './id-map';
import type { NoteMeta } from './convert';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

function drawStaveWithNotes(measureId: string, notes: Array<{ note: StaveNote }>): void {
  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(400, 200);
  const ctx = renderer.getContext();

  const stave = new Stave(10, 10, 300);
  stave.setAttribute('id', measureId);
  stave.setContext(ctx).draw();

  const vexNotes = notes.map((n) => n.note);
  if (vexNotes.length > 0) {
    Formatter.FormatAndDraw(ctx, stave, vexNotes);
  }
}

const baseMeta: Pick<NoteMeta, 'tieStart' | 'tieStop' | 'isRest' | 'keyTies'> = {
  tieStart: false,
  tieStop: false,
  isRest: false,
  keyTies: [],
};

describe('buildEventMaps', () => {
  it('maps a single note id to its drawn element and bbox', () => {
    const note = new StaveNote({ keys: ['c/4'], duration: 'q' });
    note.setAttribute('id', 'note-1');
    drawStaveWithNotes('measure-1', [{ note }]);

    const metas: NoteMeta[] = [{ vexId: 'note-1', eventIds: ['note-1'], ...baseMeta }];
    const { idToElement, idToBBox } = buildEventMaps(container, metas, 1);

    const element = idToElement.get('note-1');
    expect(element).toBeDefined();
    expect(element?.getAttribute('id')).toBe('vf-note-1');
    expect(element?.classList.contains('vf-stavenote')).toBe(true);
    expect(idToBBox.get('note-1')).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('maps every chord member event id to the same drawn element', () => {
    const chord = new StaveNote({ keys: ['c/4', 'e/4', 'g/4'], duration: 'q' });
    chord.setAttribute('id', 'chord-1');
    drawStaveWithNotes('measure-1', [{ note: chord }]);

    const metas: NoteMeta[] = [{ vexId: 'chord-1', eventIds: ['a', 'b', 'c'], ...baseMeta }];
    const { idToElement } = buildEventMaps(container, metas, 1);

    expect(idToElement.get('a')).toBe(idToElement.get('b'));
    expect(idToElement.get('b')).toBe(idToElement.get('c'));
  });

  it('resolves a duration-decomposed event to its first drawn segment', () => {
    const seg0 = new StaveNote({ keys: ['c/4'], duration: 'q' });
    seg0.setAttribute('id', 'long');
    const seg1 = new StaveNote({ keys: ['c/4'], duration: '8' });
    seg1.setAttribute('id', 'long::seg1');
    drawStaveWithNotes('measure-1', [{ note: seg0 }, { note: seg1 }]);

    const metas: NoteMeta[] = [
      { vexId: 'long', eventIds: ['long'], ...baseMeta, tieStart: true },
      { vexId: 'long::seg1', eventIds: ['long'], ...baseMeta, tieStop: true },
    ];
    const { idToElement } = buildEventMaps(container, metas, 1);

    expect(idToElement.get('long')?.getAttribute('id')).toBe('vf-long');
  });

  it('skips metas whose element was never drawn', () => {
    const metas: NoteMeta[] = [{ vexId: 'missing', eventIds: ['missing'], ...baseMeta }];
    const { idToElement, idToBBox } = buildEventMaps(container, metas, 1);
    expect(idToElement.has('missing')).toBe(false);
    expect(idToBBox.has('missing')).toBe(false);
  });

  it('scales returned bboxes by zoom (getBBox reports logical/unscaled coordinates)', () => {
    const note = new StaveNote({ keys: ['c/4'], duration: 'q' });
    note.setAttribute('id', 'scaled-note');
    drawStaveWithNotes('measure-1', [{ note }]);

    const element = container.querySelector('[id="vf-scaled-note"]') as SVGGraphicsElement;
    const original = element.getBBox;
    element.getBBox = () => ({ x: 10, y: 20, width: 30, height: 40 }) as DOMRect;

    try {
      const metas: NoteMeta[] = [{ vexId: 'scaled-note', eventIds: ['scaled-note'], ...baseMeta }];
      const atZoom1 = buildEventMaps(container, metas, 1);
      const atZoom2 = buildEventMaps(container, metas, 2);

      expect(atZoom1.idToBBox.get('scaled-note')).toEqual({ x: 10, y: 20, width: 30, height: 40 });
      expect(atZoom2.idToBBox.get('scaled-note')).toEqual({ x: 20, y: 40, width: 60, height: 80 });
    } finally {
      element.getBBox = original;
    }
  });
});

describe('buildMeasureMap', () => {
  it('maps a measure id to its drawn stave bbox', () => {
    drawStaveWithNotes('measure-42', []);
    const map = buildMeasureMap(container, ['measure-42'], 1);
    expect(map.get('measure-42')).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('omits measure ids with no drawn stave', () => {
    const map = buildMeasureMap(container, ['nope'], 1);
    expect(map.has('nope')).toBe(false);
  });

  it('scales the measure bbox by zoom', () => {
    drawStaveWithNotes('measure-zoom', []);
    const element = container.querySelector('[id="vf-measure-zoom"]') as SVGGraphicsElement;
    const original = element.getBBox;
    element.getBBox = () => ({ x: 1, y: 2, width: 3, height: 4 }) as DOMRect;

    try {
      const map = buildMeasureMap(container, ['measure-zoom'], 3);
      expect(map.get('measure-zoom')).toEqual({ x: 3, y: 6, width: 9, height: 12 });
    } finally {
      element.getBBox = original;
    }
  });
});
