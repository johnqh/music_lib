import { describe, expect, it } from 'vitest';
import { paintHighlights } from './overlay.js';
import type { CanvasRenderResult } from './canvas-renderer.js';
import { computeLayout } from './layout.js';
import type { RenderTheme } from './types.js';
import { createMock2DContext } from '../../test/canvas-stub.js';
import { twinkleScore } from '../../test/fixtures.js';

const THEME: RenderTheme = { foreground: '#000', selection: '#00f', playback: '#f00', preview: '#999' };

function fakeResult(): CanvasRenderResult {
  const plan = computeLayout(twinkleScore(), { zoom: 1, layoutMode: 'page', width: 900, theme: THEME });
  return {
    idToBBox: new Map([
      ['note-a', { x: 10, y: 20, width: 12, height: 8 }],
      ['note-b', { x: 40, y: 20, width: 12, height: 8 }],
    ]),
    measureIdToBBox: new Map(),
    drawnMeasureIndices: new Set([0]),
    plan,
    theme: THEME,
  };
}

describe('paintHighlights', () => {
  it('clears the overlay first, under an identity transform', () => {
    const ctx = createMock2DContext();
    paintHighlights(ctx, fakeResult(), { selectedIds: [], playingIds: [], previewIds: [] }, { viewportTop: 0 });
    expect(ctx.ops[0]).toEqual({ method: 'setTransform', args: [1, 0, 0, 1, 0, 0] });
    expect(ctx.ops[1].method).toBe('clearRect');
  });

  it('strokes a padded rect per highlighted id with the kind dash pattern', () => {
    const ctx = createMock2DContext();
    paintHighlights(
      ctx,
      fakeResult(),
      { selectedIds: ['note-a'], playingIds: ['note-b'], previewIds: [] },
      { viewportTop: 0 },
    );
    const strokes = ctx.ops.filter((o) => o.method === 'strokeRect');
    expect(strokes).toHaveLength(2);
    expect(strokes[0].args).toEqual([9, 19, 14, 10]); // selected: bbox padded by 1
    const dashes = ctx.ops.filter((o) => o.method === 'setLineDash').map((o) => o.args[0]);
    expect(dashes).toContainEqual([]); // selected: solid
    expect(dashes).toContainEqual([6, 3]); // playing: dashed
  });

  it('uses the dotted pattern for preview and paints playing last (precedence)', () => {
    const ctx = createMock2DContext();
    paintHighlights(
      ctx,
      fakeResult(),
      { selectedIds: ['note-a'], playingIds: ['note-a'], previewIds: ['note-a'] },
      { viewportTop: 0 },
    );
    const strokes = ctx.ops.filter((o) => o.method === 'strokeRect');
    expect(strokes).toHaveLength(3);
    // strokeStyle is a property write — the Proxy records only method calls —
    // so precedence is asserted via dash order: preview ([2,3]) then
    // selected ([]) then playing ([6,3]) then the trailing reset ([]).
    const dashes = ctx.ops.filter((o) => o.method === 'setLineDash').map((o) => o.args[0]);
    expect(dashes).toEqual([[2, 3], [], [6, 3], []]);
  });

  it('applies the dpr and scroll transform for the paint pass', () => {
    const ctx = createMock2DContext();
    paintHighlights(ctx, fakeResult(), { selectedIds: [], playingIds: [], previewIds: [] }, { viewportTop: 120, devicePixelRatio: 2 });
    const transforms = ctx.ops.filter((o) => o.method === 'setTransform');
    expect(transforms[1].args).toEqual([2, 0, 0, 2, 0, -240]);
  });

  it('skips ids with no bbox (outside the drawn window) without throwing', () => {
    const ctx = createMock2DContext();
    paintHighlights(ctx, fakeResult(), { selectedIds: ['missing'], playingIds: [], previewIds: [] }, { viewportTop: 0 });
    expect(ctx.ops.filter((o) => o.method === 'strokeRect')).toHaveLength(0);
  });
});

describe('paintHighlights: horizontal scroll offset', () => {
  it('includes viewportLeft in the draw transform', () => {
    const ctx = createMock2DContext();
    paintHighlights(
      ctx,
      fakeResult(),
      { selectedIds: ['note-a'], playingIds: [], previewIds: [] },
      { viewportTop: 120, viewportLeft: 80, devicePixelRatio: 2 },
    );
    const transforms = ctx.ops.filter((o) => o.method === 'setTransform');
    expect(transforms[1]?.args).toEqual([2, 0, 0, 2, -160, -240]);
  });
});
