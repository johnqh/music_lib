// jsdom does not implement the Pointer Capture APIs. Historically needed
// because music_app's volume/pan sliders were MUI's <Slider>, which called
// these unconditionally while handling a pointerdown/pointerup drag (only
// `setPointerCapture` itself was guarded, in application code, against
// throwing -- `hasPointerCapture`/`releasePointerCapture` weren't, and would
// otherwise throw "not a function" the moment a test simulated a real
// pointer-drag interaction). music_app's T12 Tailwind re-skin replaced those
// with native `<input type="range">` elements (see music_app's
// `src/test/drag-slider.ts`), which don't call these APIs from application
// code -- kept here defensively (harmless no-op) in case any future adapter
// or consuming app's test suite still exercises a real pointer-capture path.
for (const method of [
  'hasPointerCapture',
  'setPointerCapture',
  'releasePointerCapture',
] as const) {
  if (typeof Element !== 'undefined' && !Element.prototype[method]) {
    Object.defineProperty(Element.prototype, method, {
      value: (): boolean => false,
      writable: true,
      configurable: true,
    });
  }
}
