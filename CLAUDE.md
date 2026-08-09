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
- `src/services/` — playback controller singleton (lazy Proxy; safe to import before store init), autosave debouncer, device-prefs persistence (`prefs.ts` via injected PrefsStorage), import-export, quantize worker service, errors, benchmark
- `src/store/` — Zustand slices (score/selection/playback/generation/project/ui; `ui-slice.activeTrackId` + `selectActiveTrackId`, `selection-slice.selectionRegenerated`) + memoized selectors; `context.ts` defines `StoreContext { client: MusicClient; getToken; storage?; provider? }` and `ApiGenerationProvider`; `createAppStore({ context })` is the factory, `initializeAppStore(context)` boots the app-wide `useAppStore` hook (lazy delegate)
- `src/templates/` — deterministic "New from template" starter scores (replaced the Dexie sample installer)
- `src/workers/` — module workers (midi-import, quantize); services fall back to inline processing when `Worker` is undefined
- `src/test/fixtures.ts` — deterministic score builders (exported for downstream suites)

Everything exports from `src/index.ts` (package root import only).

## Architectural Rules

- Domain code (`src/domain/**`) must not import React, VexFlow, Tone, Dexie, or browser-only APIs
- Every score mutation goes through a `ScoreCommand` via the store's `dispatchCommand`; commands are pure (Immer patches for undo)
- Ticks are integers (480 PPQ default); never floating-point seconds in the musical timeline
- VexFlow/Tone objects never live in Zustand state (renderer in refs, engine in the controller singleton)
- Voices correlate across measures by ordinal index in `measure.voices`, not by voice id

## Gotchas

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
- **This package is platform-free, and three guard tests keep it that way**
  (`src/platform/no-platform-imports.test.ts`): no `tone`/`@tonejs/midi` import,
  no platform runtime dependency, no DOM global outside the canvas renderer.
  Runtime dependencies are exactly `immer`, `vexflow` and `zod`. Without the
  guards nothing would notice a regression — every test here runs in jsdom,
  where the offending import works fine, and the breakage only appears in a
  React Native bundle.
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
- **The MIDI worker takes a decoded `MidiFile`, not bytes.** A `MidiCodec` is not
  structured-cloneable, and importing one inside the worker would make this
  package depend on `music_io`, which already peer-depends on this one. So the
  service decodes on the main thread (parsing is cheap) and the worker does the
  quantization and voice allocation it exists for. `importMidiFile` /
  `analyzeMidiFile` are that seam.
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
