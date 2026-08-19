import { describe, expect, it } from 'vitest';
import { createMock2DContext } from './canvas-stub.js';

describe('createMock2DContext', () => {
  it('records draw calls with arguments', () => {
    const ctx = createMock2DContext();
    ctx.beginPath();
    ctx.moveTo(1, 2);
    ctx.fillRect(0, 0, 10, 10);
    expect(ctx.ops.map(o => o.method)).toEqual([
      'beginPath',
      'moveTo',
      'fillRect',
    ]);
    expect(ctx.ops[2].args).toEqual([0, 0, 10, 10]);
  });

  it('accepts style property writes and measureText', () => {
    const ctx = createMock2DContext();
    ctx.fillStyle = '#fff';
    ctx.font = '10pt Arial';
    expect(ctx.measureText('abc').width).toBeGreaterThan(0);
  });

  it('exposes a canvas back-reference with the given dimensions', () => {
    const ctx = createMock2DContext(320, 240);
    expect(ctx.canvas.width).toBe(320);
    expect(ctx.canvas.height).toBe(240);
  });
});
