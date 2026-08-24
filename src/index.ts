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
/*
  The note-file codecs live in `@sudobility/music_codecs` and are re-exported
  here.

  They used to exist in both packages, and had diverged: `music_api` imported
  music_codecs while this package used its own copies, so the server and the
  browser encoded MIDI differently — the server's exports were still missing
  every dynamic, hairpin and articulation. One home, re-exported, so an
  `@sudobility/music_lib` import keeps working and there is nothing left to
  drift.
*/
export * from '@sudobility/music_codecs';
/*
  The renderer lives in `@sudobility/music_drawing` and is re-exported here.

  It was `src/adapters/vexflow/` — 8,400 lines that depended on nothing in this
  package, only on the model and on VexFlow. Splitting it out means the print
  view and the public score page can draw a score without pulling in a store,
  a network client and an audio engine, and it keeps this package from having
  to carry a rendering engine in order to offer business logic.
*/
export * from '@sudobility/music_drawing';

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

// services
export * from './services/playback/adapter.js';
/** Re-exported so the app's React bindings and their tests reach one bus type. */
export { PlaybackBus } from '@sudobility/music_player/core';
export * from './services/errors.js';
export * from './services/messages.js';
export * from './services/editing/copy.js';
export * from './services/editing/editing.js';
export * from './services/perf/benchmark.js';
export * from './services/persistence/autosave.js';

export * from './services/selection/singleton.js';

// store
export * from './store/context.js';
export * from './services/prefs.js';
export * from './templates/index.js';
export * from './store/slices/track-slice.js';
export * from './store/slices/ui-slice.js';
export * from './store/useAppStore.js';
export * from './store/selectors.js';

// platform

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
