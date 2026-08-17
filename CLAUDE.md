# @sudobility/music_lib

Business logic for ScoreSmith (the Sudobility music app family): the entire non-UI layer — score domain model, undoable commands, validation, quantization, rendering/audio/file adapters, and the Zustand app store.

## Tech Stack

- TypeScript (strict), ESM, built with plain `tsc -p tsconfig.build.json` (relative imports only — no path aliases; dist is bundler-consumed)
- Types/schemas from `@sudobility/music_types`
- VexFlow 4 (windowed **canvas** notation — the SVG renderer was deleted; see adapters below), Tone.js 15 (audio), @tonejs/midi, Zustand 5 + Immer, Zod 4, @sudobility/music_client (server persistence + AI via music_api; Dexie and the mock AI stack were removed in Phase 2)
- Bun for scripts, vitest + jsdom for tests; canvas tests use `createMock2DContext` (`src/test/canvas-stub.ts`, exported from the package root for consuming apps' jsdom suites too)
- Published to npm as `@sudobility/music_lib` (restricted) via CI on push to main

## Commands

- `bun install` — install dependencies
- `bun run verify` — typecheck + lint + test + build (run before any push; ~775 tests)
- `bun run test` / `bun run test:watch` — vitest
- `bun run build` — emit `dist/`

## Structure

- `src/domain/` — framework-free core: `score/` (factories, queries, ties, fragments, ids), `commands/` (ScoreCommand factories, HistoryManager, reflow), `validation/`, `quantization/`, `voicing/`, `selection/`, `time/` (fractions/ticks/tempo/durations), `pitch/`
- `src/adapters/` — `vexflow/` (`CanvasScoreRenderer` — windowed, viewport-only canvas drawing with O(visible) per-frame cost, coloring each note by state via `note-color.ts`'s role precedence; `layout.ts` binary-search lookups + the measure-number gutter band; `playhead.ts` caret/seek helpers; `measure-content.ts` shared Stave/Voice/tie builders), `tone/` (playback engine + instruments), `midi/`, `musicxml/`
- `src/services/` — playback controller singleton (lazy Proxy; safe to import before store init), autosave debouncer, device-prefs persistence (`prefs.ts` via injected PrefsStorage), import-export, errors, benchmark
- `src/store/` — Zustand slices (score/selection/playback/generation/project/ui; `ui-slice.activeTrackId` + `selectActiveTrackId`, `selection-slice.selectionRegenerated`) + memoized selectors; `context.ts` defines `StoreContext { client: MusicClient; getToken; storage?; provider? }` and `ApiGenerationProvider`; `createAppStore({ context })` is the factory, `initializeAppStore(context)` boots the app-wide `useAppStore` hook (lazy delegate)
- `src/templates/` — deterministic "New from template" starter scores (replaced the Dexie sample installer)
- `src/test/fixtures.ts` — deterministic score builders (exported for downstream suites)

Everything exports from `src/index.ts` (package root import only).

## Architectural Rules

- Domain code (`src/domain/**`) must not import React, VexFlow, Tone, Dexie, or browser-only APIs
- Every score mutation goes through a `ScoreCommand` via the store's `dispatchCommand`; commands are pure (Immer patches for undo)
- Ticks are integers (480 PPQ default); never floating-point seconds in the musical timeline
- VexFlow/Tone objects never live in Zustand state (renderer in refs, engine in the controller singleton)
- Voices correlate across measures by ordinal index in `measure.voices`, not by voice id

## Gotchas

- **The renderer caches one built frame, and that is what makes playback affordable.** Constructing and formatting VexFlow objects is the expensive half — measured at 45ms for a twelve-track sixteenth-note window, 94ms at zoom 0.5 — and a note starting to sound changes none of it. `buildSystem` produces a `SystemDrawing` with no colour in it; `paintSystem` applies colour and draws. The cache key covers score identity, zoom, layout mode, width, track set and viewport, and deliberately **not** the theme, note colours, active track or selection, which are exactly what a repaint changes. Measured after: 4.2ms and 23.7ms. One frame rather than an LRU, because during playback the viewport is still and consecutive repaints hit it; scrolling misses and rebuilds, which is what it always did.
- **Event bboxes are recorded after painting, never before.** VexFlow reports a bounding box only once an object has been drawn, so reading them off freshly-built objects yields zeros — which showed up as every note's click target sitting at x=0. They are geometry, so they are computed once per built frame and reused by every repaint of it.
- **Per-stave culling was tried and reverted; do not re-attempt it naively.** Skipping the note-building for off-screen tracks is the obvious win at two hundred tracks, but it changes the joint formatter's input: a tick context contributed only by a culled track disappears and the visible notes slide. An invisible alignment voice of `GhostNote`s restores the tick *positions* but not the glyph *widths*, and the residual drift measured **13.5px** — plainly visible while scrolling. Any future attempt needs the cached frame to hold the whole column's formatting and cull only at draw time.

- **`ScoreCommand` declares `kind: 'content' | 'mix'`, and it is required.** Content is immutable while the transport plays: `score-slice`'s `dispatchCommand`/`undo`/`redo` refuse it. Mixing — volume, pan, mute, solo — is exempt and reaches the engine live through `applyMix`. `changeTrackPropsCommand` carries a partial patch and serves both, so it classifies from its own patch (mix only if *every* key is); every other factory inherits `'content'` from `snapshotCommand`. Required rather than optional so a command written later without thinking about the lock is refused rather than admitted — the typecheck caught a hand-rolled literal in `history.test.ts` the moment it landed.
- **`PlaybackController.handleScoreChange` has exactly two branches, and the lock is what allows the first.** Playing → `engine.applyMix(score)`, no reload, no reschedule. Otherwise → load the score. It used to be a stop-reload-seek-resume cycle with `pendingResume` and `scoreChangeGeneration` deciding which of several in-flight calls owned the resume; all of that existed to make a burst of edits during playback safe, and editing during playback is now refused. **If the lock is ever loosened, that code has to come back** — the no-reload branch is only sound because a content change cannot have happened.

- **`Track.midiProgram` means two different things, and `track-instrument.ts`
  is the only place that knows which.** On a percussion-clef track it addresses
  a General MIDI *drum kit* (`gm-kit.ts`); everywhere else it is an instrument
  (`gm.ts`). The two never coincide — Brush is kit 40, and program 40 is Violin
  — so every program-keyed table (`gm-range`, `gm-polyphony`,
  `gm-transposition`, `gm-icon`) gives a confidently wrong answer for a drum
  track. Take a `Track` and call `trackKeyboardRange`/`trackMaxPolyphony`/
  `trackWrittenTransposition`/`trackInstrumentIcon` instead; the program-keyed
  functions stay exported for callers that genuinely hold only a program.
  `scoreWithResolvedKits` (run by `setScore`) snaps a percussion track to a real
  kit and returns the **identical score** when there is nothing to fix, which is
  what keeps opening a project from marking it dirty.
- **The autosave omits the score when the score has not changed.**
  `project-slice` keeps the last-saved score by *identity* — every mutation
  goes through a command that returns a new object, so an unchanged reference
  is an unchanged score — and a save that exists only to persist
  `visibleTrackIds` or `zoom` sends `{name, uiPrefs}`. Hiding a track used to
  ship the entire score to record a list of track ids. A write returns
  `ProjectSaveResult`, not a record: the score travels in one direction per
  save, and `adopt` therefore takes the score as its own argument (for a
  create, the copy the caller just sent).
- **`serverUpdatedAt` exists so a client can recognise its own writes.** It
  records where the last read or write left the server. A poller comparing
  only against *its own* last observation reads every autosave as a foreign
  change — which made the editor re-download the project it had just uploaded
  and reset the undo history seconds after every edit. A write that goes
  around the autosaver must call `noteServerVersion`.
- **This package is platform-free, and five guard tests keep it that way**
  (`src/platform/no-platform-imports.test.ts`): no `tone`/`@tonejs/midi` import,
  no platform runtime dependency, no web-only global outside the canvas
  renderer, no `import.meta`, and no `Worker`. Runtime dependencies are exactly
  `immer`, `vexflow` and `zod`. Without the guards nothing would notice a
  regression — every test here runs in jsdom, where the offending import works
  fine, and the breakage only appears in a React Native bundle. The rules grep
  raw source with comments stripped, so reword a doc comment rather than
  weakening a rule.
- **`import.meta` is the hazard a `typeof` guard cannot cover.** It is syntax,
  not a value: React Native's bundler transforms modules to CommonJS, where it
  has no meaning, so a module using it fails to *parse* rather than falling
  back. It shipped here twice — `import.meta.env.DEV` in `services/errors.ts`
  and `new Worker(new URL(..., import.meta.url))` in two services — and neither
  Node nor Vite nor this suite objected. Anything environment-shaped is now
  injected by the app: `setErrorLogging` for dev-only console output.
- **Platform services arrive two different ways.** Playback is a long-lived
  singleton reached through a module import, so it comes from the registry
  (`initializeMusicPlatform` / `getMusicPlatform`); `playbackController`'s lazy
  Proxy resolves the engine on first use, which is why every call site kept
  working when the engine moved out. Everything stateless — `XmlParser`,
  `MidiCodec` — is a function or constructor parameter instead, so those stay
  testable with no global setup.
- **`vexflow` stays here** because it is not actually platform-bound: the canvas
  renderer draws into a 2D context the caller supplies, and was verified to
  render a full score with no DOM present at all.
- **There are no workers, deliberately.** `src/workers/` held two — thin
  wrappers moving `quantizeEvents` and `importMidiFile` off the main thread —
  plus `MidiService`/`QuantizeService` to drive them and a requestId/postMessage
  protocol. Threading is a platform capability like audio or file access, and
  this was the one that never got extracted; supporting React Native would have
  meant an injection seam for worker construction on top of everything else. So
  the offload was measured first: `quantizeEvents` takes **0.57ms** at the
  2000-event count where music_app routed to the worker (1.40ms at 10k, 9.53ms
  at 50k), against a ~5ms notation redraw — and `postMessage` structure-clones
  the whole event array in each direction. There is no note count at which the
  clone is cheaper than the work. All of it was deleted; the synchronous path
  the services fell back to, which every test and every non-web platform
  already took, is now the only path. `importMidiFile` / `analyzeMidiFile`
  survive as the pure `MidiFile`-in seam (a `MidiCodec` was never
  structured-cloneable, and importing one here would invert the `music_io`
  dependency).
- **Tests use `@sudobility/music_io/mocks`, never `music_io/web`.** The web entry
  imports this package, so reaching for it in a test pulls this package's own
  published dist back in through its dependency.

- There is no highlight overlay. Note state is the notehead's own color: callers pass `noteColors` (an `eventId -> NoteColorRole` map) and `activeTrackId` into `CanvasScoreRenderer.render`, and `RenderTheme` carries one color per state. `paintHighlights`/`overlay.ts` were deleted — don't reintroduce a second canvas.
- VexFlow's `Stave.draw` restores its style *before* drawing clef/key/time modifiers, and `StaveNote.draw` applies its own style across its modifiers — so one `setStyle` per element is enough, and an inactive track's clef never inherits the dimmed stave color.

- `dist/` emits proper ESM with explicit `.js` relative extensions (source imports use `.js` specifiers, mapped to `.ts` by bundler moduleResolution); raw Node still can't import it because some deps (@tonejs/midi) are CJS — consume via a bundler, vitest, or Bun
- The playback controller is a module-level singleton that constructs Tone objects at import — component tests in consuming apps must mock it
- Two `safeFilename` helpers existed (midi/musicxml); the package root re-exports the midi one only

## Related Projects

- `music_types` — shared types/schemas · `music_client` — network client · `music_api` — backend · `music_app` — web UI
