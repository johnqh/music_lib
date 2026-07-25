
// jsdom does not implement SVGElement.prototype.getBBox, but VexFlow (used by
// src/adapters/vexflow) calls it both internally (text measurement) and from
// our own id-map bbox lookups. Stub it with a zeroed box so VexFlow can render
// to SVG in jsdom-based tests; geometry assertions are out of scope for those
// tests (jsdom has no layout engine), only DOM structure is asserted.
if (typeof SVGGraphicsElement !== 'undefined' && !SVGGraphicsElement.prototype.getBBox) {
  Object.defineProperty(SVGGraphicsElement.prototype, 'getBBox', {
    value: (): DOMRect => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }),
    writable: true,
    configurable: true,
  });
}

// jsdom does not implement the Pointer Capture APIs, which MUI's <Slider>
// (used throughout src/components/layout, src/components/inspector) calls
// unconditionally while handling a pointerdown/pointerup drag (only
// `setPointerCapture` itself is guarded, in application code, against
// throwing -- `hasPointerCapture`/`releasePointerCapture` aren't, and would
// otherwise throw "not a function" the moment a test simulates a real
// pointer-drag interaction, e.g. src/test/drag-slider.ts).
for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
  if (typeof Element !== 'undefined' && !Element.prototype[method]) {
    Object.defineProperty(Element.prototype, method, {
      value: (): boolean => false,
      writable: true,
      configurable: true,
    });
  }
}
