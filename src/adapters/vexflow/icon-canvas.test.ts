import { describe, expect, it } from 'vitest';
import { createMock2DContext } from '../../test/canvas-stub.js';
import { strokeInstrumentIcon } from './icon-canvas.js';
import { ICON_VIEWBOX } from '../../domain/instruments/icon-art.js';
import type { InstrumentIconArt } from '../../domain/instruments/icon-art.js';

const ART: InstrumentIconArt = {
  name: 'test',
  shapes: [
    { kind: 'path', d: 'M1 2 L3 4 C5 6 7 8 9 10 Q1 1 2 2 Z' },
    { kind: 'circle', cx: 12, cy: 12, r: 3 },
  ],
};

function methods(ctx: ReturnType<typeof createMock2DContext>): string[] {
  return ctx.ops.map((o) => o.method);
}

describe('strokeInstrumentIcon', () => {
  it('replays every path command onto the context', () => {
    const ctx = createMock2DContext();
    strokeInstrumentIcon(ctx, ART, 0, 0, ICON_VIEWBOX);

    expect(methods(ctx)).toEqual(
      expect.arrayContaining([
        'moveTo',
        'lineTo',
        'bezierCurveTo',
        'quadraticCurveTo',
        'closePath',
        'arc',
      ]),
    );
  });

  it('moves to the circle start before arcing, so circles are not chained together', () => {
    // `arc` draws a line from the current point to the arc's start; without the
    // moveTo, every circle would be tied to whatever was drawn before it.
    const ctx = createMock2DContext();
    strokeInstrumentIcon(ctx, ART, 0, 0, ICON_VIEWBOX);

    const arcIndex = methods(ctx).indexOf('arc');
    expect(ctx.ops[arcIndex - 1]).toEqual({ method: 'moveTo', args: [15, 12] });
  });

  it('strokes the whole icon in one path', () => {
    const ctx = createMock2DContext();
    strokeInstrumentIcon(ctx, ART, 0, 0, ICON_VIEWBOX);

    const drawn = methods(ctx);
    expect(drawn.filter((m) => m === 'beginPath')).toHaveLength(1);
    expect(drawn.filter((m) => m === 'stroke')).toHaveLength(1);
  });

  it('places and scales the art into the requested box', () => {
    const ctx = createMock2DContext();
    strokeInstrumentIcon(ctx, ART, 40, 60, ICON_VIEWBOX / 2);

    expect(ctx.ops.find((o) => o.method === 'translate')).toEqual({
      method: 'translate',
      args: [40, 60],
    });
    expect(ctx.ops.find((o) => o.method === 'scale')).toEqual({
      method: 'scale',
      args: [0.5, 0.5],
    });
  });

  it('brackets its transform with save/restore so the caller keeps theirs', () => {
    // The gutter renders under a pinned, zoom-and-DPR-scaled transform that must
    // survive drawing an icon.
    const ctx = createMock2DContext();
    strokeInstrumentIcon(ctx, ART, 0, 0, ICON_VIEWBOX);

    const drawn = methods(ctx);
    expect(drawn[0]).toBe('save');
    expect(drawn.at(-1)).toBe('restore');
  });
});
