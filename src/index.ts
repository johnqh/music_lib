/*
  The model and its primitives live in `@sudobility/music_types` and are
  re-exported here.

  They used to exist in both packages — 128 modules, most differing only by an
  import path, and three that had genuinely diverged because new commands were
  added on this side only. That is what a copy does: it works until somebody
  fixes a bug in one of them. `music_types` is now the single home, and this
  line is what keeps every existing `@sudobility/music_lib` import working.
*/
export * from '@sudobility/music_types';

/**
 * @sudobility/music_lib — Moosiac business logic.
 *
 * Domain layer (framework-free): score model factories/queries, undoable
 * commands + history, validation, quantization, voice allocation,
 * selection helpers, time/pitch math. Types and schemas come from
 * @sudobility/music_types (re-exported by the relevant modules for
 * convenience). Adapters (VexFlow/Tone/MIDI/MusicXML), services, and the
 * Zustand store are exported from here as well (added incrementally).
 */

// domain/score
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';

// domain/selection
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';

// domain/commands
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';

// domain/validation
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';

// domain/quantization
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';

// domain/voicing
export * from '@sudobility/music_types';

// domain/time
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';

// domain/instruments
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';

// domain/pitch
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';

// test fixtures (deterministic score builders — used by downstream test suites)
export * from './test/fixtures.js';
export * from './test/store-context.js';
export * from './test/canvas-stub.js';

// adapters/vexflow
export * from './adapters/vexflow/types.js';
export * from './adapters/vexflow/measure-content.js';
export * from './adapters/vexflow/convert.js';
export * from './adapters/vexflow/layout.js';
export * from './adapters/vexflow/pagination.js';
export * from './adapters/vexflow/playhead.js';
export * from './adapters/vexflow/canvas-renderer.js';
export * from './adapters/vexflow/note-color.js';

// adapters/mod
export * from './adapters/mod/types.js';
export * from './adapters/mod/timing.js';
export * from './adapters/mod/import.js';
export * from './adapters/mod/limits.js';
export * from './adapters/mod/export.js';

// adapters/midi
export * from './adapters/midi/analyze.js';
export * from './adapters/midi/grid-detection.js';
export * from './adapters/midi/import.js';
export * from './adapters/midi/import-options.js';
export * from './adapters/midi/export.js';
export * from './adapters/midi/measures.js';
export * from './adapters/midi/key-detection.js';

// adapters/musicxml
export * from './adapters/musicxml/import.js';
export { escapeXml, exportMusicXml } from './adapters/musicxml/export.js';
export * from './adapters/musicxml/duration-map.js';

// services
export * from './services/errors.js';
export * from './services/messages.js';
export * from './services/import-export/musicxml-service.js';
export * from './services/export/render-events.js';
export * from './services/perf/benchmark.js';
export * from './services/persistence/autosave.js';
export * from './services/playback/types.js';
export * from './services/playback/plan.js';
export * from './services/playback/controller.js';
export * from './services/playback/bus.js';

// store
export * from './store/context.js';
export * from './services/prefs.js';
export * from './templates/index.js';
export * from './store/slices/track-slice.js';
export * from './store/slices/ui-slice.js';
export * from './store/useAppStore.js';
export * from './store/selectors.js';

// platform
export * from './platform/registry.js';

// Pure editing logic, moved out of music_app: none of it touches React, the
// DOM or layout geometry, so it belongs with the model rather than the UI.
export * from '@sudobility/music_types';
export * from './domain/notation/note-entry.js';
export * from './domain/notation/pitch-drag.js';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
export * from '@sudobility/music_types';
