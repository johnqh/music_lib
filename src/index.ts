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
/*
  The renderer lives in `@sudobility/music_drawing` and is re-exported here.

  It was `src/adapters/vexflow/` — 8,400 lines that depended on nothing in this
  package, only on the model and on VexFlow. Splitting it out means the print
  view and the public score page can draw a score without pulling in a store,
  a network client and an audio engine, and it keeps this package from having
  to carry a rendering engine in order to offer business logic.
*/

/**
 * @sudobility/music_lib — Moosiac business logic.
 *
 * The exports below are the library-owned services and platform-free
 * application rules. Hosts compose this package with codecs and drawing.
 */

// test fixtures (deterministic score builders — used by downstream test suites)
export * from './test/fixtures';
export * from './test/canvas-stub';

// business services
export * from './services/messages';
export * from './services/generation/request';
export * from './services/generation/score-duration';
export * from './services/generation/credits';
export * from './services/generation/new-project-draft';
export * from './services/generation/labelled-options';
export * from './services/generation/replace-draft';
export * from './services/generation/generation-locks';
export * from './services/import/midi-import-options';
export * from './services/persistence/autosave';
export * from './services/prefs';
export * from './templates/index';
export * from './services/documents/unsaved-guard';
export * from './services/docs/docs-content';
export * from './services/docs/resource-links';
