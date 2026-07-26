/**
 * A recording stand-in for `CanvasRenderingContext2D`: every method call is
 * appended to `ops`; every property write is accepted; `measureText`
 * returns a deterministic width (8px/char) so VexFlow text layout math
 * stays finite. Proxy-based so any method VexFlow's `CanvasContext` calls
 * is recorded without this double having to enumerate the whole 2D API —
 * new methods VexFlow starts calling never require test-double updates.
 *
 * Exported from the package root (like `testStoreContext`) so downstream
 * suites — music_app's jsdom setup stubs `HTMLCanvasElement.getContext`
 * with it — share one implementation.
 */

export type MockOp = { method: string; args: unknown[] };
export type Mock2DContext = CanvasRenderingContext2D & { ops: MockOp[] };

export function createMock2DContext(width = 800, height = 600): Mock2DContext {
  const ops: MockOp[] = [];
  const state: Record<string | symbol, unknown> = {
    ops,
    canvas: { width, height },
    measureText: (text: string) => ({
      width: String(text).length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const fn = (...args: unknown[]) => {
        ops.push({ method: String(prop), args });
        return undefined;
      };
      target[prop] = fn;
      return fn;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as Mock2DContext;
}
