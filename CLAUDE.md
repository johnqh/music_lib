# @sudobility/music_lib

> **Git policy — never auto-commit or auto-push.** Leave your work in the working tree.
> Run `git commit`, `git push`, `gh pr create`, or `scripts/push_all.sh` **only when the user
> explicitly asks in that turn**. Approval for an earlier change does not carry forward, and
> finishing a task is not permission to commit it.

Frontend business logic for Moosiac (the Sudobility music app family), **above editing**: the composed app store and the per-document stores, autosave and project writes, the player binding (`bindPlayer`) and playback adapter, export planning (`planExport`), the unsaved-work guard (`decideClose`/`decideQuit`), the documentation content (`DOCS_TOPICS`, `RESOURCE_GROUPS`), generation request builders and drafts, credits, device prefs (theme, developer mode and settings, keyboard, font size, language; `resolveThemeMode`) and host copy wiring. It re-exports `@sudobility/music_types`, `@sudobility/music_editing`, `@sudobility/music_codecs` and `@sudobility/music_drawing` wholesale, so an app imports one package. Every shared type and closed vocabulary is music_types'; every operation that changes a score is music_editing's.

- **`music-vocabulary.ts` says score values the way a musician says them** — and it is music_types' (`domain/notation/music-vocabulary.ts`), re-exported from here. Ticks, fifths and zero-based voice indexes are the right things to compute with and the wrong things to show, so the conversions — note-value names, key names (`D major`, `2 sharps`), bar/beat positions, and the pitch at a staff position — live in the model rather than in an app. Which tick count is a quarter note and how many sharps D major has are facts about music. No translatable prose: note values and key names are domain terms, fixed across locales the way General MIDI's instrument names are. `pitchAtStavePosition` is measured from each clef's top line, which is what lets an editor turn a click on a stave into a pitch that agrees with what was drawn.

## Tech Stack

- TypeScript (strict), ESM, built with plain `tsc -p tsconfig.build.json` (relative imports only — no path aliases; dist is bundler-consumed)
- Types/schemas from `@sudobility/music_types`
- Runtime dependencies `@sudobility/music_codecs`, `@sudobility/music_drawing`, `@sudobility/music_player` (through `/core` only), Immer and Zod; peers `@sudobility/music_types`, `@sudobility/music_editing`, `@sudobility/music_client` (server persistence + AI via music_api), React Query, React, Zustand 5
- Bun for scripts, vitest + jsdom for tests; canvas tests use `createMock2DContext` (`src/test/canvas-stub.ts`, exported from the package root for consuming apps' jsdom suites too)
- Published to npm as `@sudobility/music_lib` (restricted) via CI on push to main

## Commands

- `bun install` — install dependencies
- `bun run verify` — typecheck + lint + test + build (run before any push; 336 tests in 35 files as of 2026-09-15)
- `bun run test` / `bun run test:watch` — vitest
- `bun run build` — emit `dist/`

## Structure

The score model, commands and primitives are music_types'; the editing slices (score, selection, track, ui) are music_editing's; the renderer is music_drawing's; the codecs are music_codecs'; the engines and plans are music_player's. What is left here:

- `src/services/playback/` — `adapter.ts` (the playback controller singleton; lazy Proxy, safe to import before store init) and `bind-player.ts` (`bindPlayer`, `TRANSPORT_SETTINGS_DEFAULTS`)
- `src/services/prefs.ts` — device prefs: `createDevicePrefsSlice`, `createDevicePrefsStore`, `mirrorDevicePrefs`, `resolveThemeMode`, persistence via an injected `PrefsStorage`
- `src/services/export/export-plan.ts` (`planExport`), `src/services/documents/unsaved-guard.ts` (`decideClose`/`decideQuit`), `src/services/docs/` (`docs-content.ts`: `DOCS_TOPICS`/`docsTopic`/`docsGroupLabelKey`; `resource-links.ts`: `RESOURCE_GROUPS`/`hostOf`/`monogramFor`)
- `src/services/generation/` (request builders, drafts, locks, credits), `persistence/` (autosave, document saver, project writes), `import/`, `perf/`, `errors.ts`, `messages.ts`, `library-copy.ts`
- `src/store/` — `slices/` (generation, playback, project), `context.ts` (`StoreContext`), `useAppStore.ts` (`createAppStore({ context })` composes music_editing's slices with these; `initializeAppStore(context)` boots the app-wide `useAppStore` hook), `document-store.ts` (`createDocumentStore`, a store per document)
- `src/templates/` — deterministic "New from template" starter scores (replaced the Dexie sample installer)
- `src/test/fixtures.ts` — deterministic score builders (exported for downstream suites)

Everything exports from `src/index.ts` (package root import only).

## Architectural Rules

- There is no domain code here any more: the model, commands and pure primitives are music_types' and must not import React, VexFlow, a synth or browser-only APIs there. What this package holds is platform-free too (see the `no-platform-imports.test.ts` gotcha below)
- Every score mutation goes through a `ScoreCommand` (music_types' `domain/commands/`) via the store's `dispatchCommand` (music_editing's `score-slice`); commands are pure
- Ticks are integers (480 PPQ default); never floating-point seconds in the musical timeline
- VexFlow and player objects never live in Zustand state (renderer in refs, player in music_player's singleton)
- Voices correlate across measures by ordinal index in `measure.voices`, not by voice id

## Gotchas

- **One fact, one declaration — and `src/__single-source.test.ts` enforces it.** A constant restated in a second package agrees with the first right up until one of them is edited, and nothing fails when they part: the build is clean, the types match, and the only symptom is a wrong sound or a picker quietly missing an entry. Measured across the family, 23 UPPER_CASE constants were declared in more than one repo — `CC_VOLUME` three times, `DYNAMICS` four, `C_MAJOR` five, and `DEFAULT_TIME_SIGNATURE` in four places under two names. The guard reads the list of names **from music_types at runtime** rather than restating it, because a check against duplication that duplicates what it checks would drift like everything else; its `ALLOWED` list is empty on purpose, so an exemption is a decision somebody writes down. Two shapes matter beyond the constants themselves. **A closed vocabulary is declared as an array and the type read off it** (`export const DYNAMICS = [...] as const; export type Dynamic = (typeof DYNAMICS)[number];`) — a TypeScript union has no runtime form, so anything that must *validate* a value has to write the list out again, which is exactly how music_api's decoder came to check generated music against its own private copy. **A label or option list keyed by the vocabulary is a `Record<T, ...>`, never a parallel array** — a record fails to compile when a member is added, an array silently goes on offering the old set; that is why the inspector's picker lists are `ACCIDENTAL_OPTIONS`/`ARTICULATION_OPTIONS` built from the vocabulary rather than `ACCIDENTALS`/`ARTICULATIONS` retyped. Test fixtures follow the same rule: the score fixtures live once, in `@sudobility/music_types/test`, and a package that needs a rendering fixture of its own re-exports them and adds to them.

- **Both plans are music_player's now, not this package's.** `renderEvents(score) → RenderPlan` for offline audio, `playbackPlan(score) → PlaybackPlan` for live playback, `playbackTracks` (mix changes, which must not rebuild notes) and `resolveVoice` (the kit-versus-instrument rule) live in music_player's `shared/plan.ts`/`shared/render-events.ts` and are exported from its `/core`. Neither music_player nor music_io depends on anything from here — a contract test in each enforces it — so anything an engine needs must be resolved into the plan first.
- **Tracker import and `fill.ts` are music_codecs'** (`src/mod/import.ts`'s `trackerToScore`, `src/mod/fill.ts`, `src/tracker/period.ts`'s `periodToMidi`); `TrackerModule` is music_types'. Why the model is format-neutral and why every voice is filled with rests is recorded in music_codecs' CLAUDE.md.
- **The canvas renderer is music_drawing's** (`CanvasScoreRenderer`, `computeLayout`). How it stays affordable during playback — colour-free built drawings reused across repaints, bboxes measured only once a note is drawn, staves culled at draw time rather than build time, the cached layout plan — is recorded in music_drawing's CLAUDE.md.

- **`ScoreCommand` declares `kind: 'content' | 'mix'`, and it is required — none of it lives here, but this package's adapter depends on it.** The type and the factories are music_types' (`domain/commands/`); the lock is music_editing's `score-slice`, whose `dispatchCommand`/`undo`/`redo` refuse a content command while the transport plays (`commandAllowed`). Mixing — volume, pan, mute, solo — is exempt and reaches the engine live through `applyMix`. `changeTrackPropsCommand` (music_types' `structure-commands.ts`) carries a partial patch and serves both, so it classifies from its own patch (mix only if *every* key is); every other factory inherits `'content'` from `snapshotCommand`. Required rather than optional so a command written later without thinking about the lock is refused rather than admitted — the typecheck caught a hand-rolled literal in music_types' `history.test.ts` the moment it landed. It is recorded here because `services/playback/adapter.ts` treats a score change during playback as a mix change and does not reload, which is only sound while that lock holds.
- **`IMusicPlayer.load` has exactly two branches, and the lock is what allows the first.** Playing → `applyMix(tracks)`, no reload, no reschedule. Otherwise → build a plan and load it. It used to be a stop-reload-seek-resume cycle with `pendingResume` and `scoreChangeGeneration` deciding which of several in-flight calls owned the resume; all of that existed to make a burst of edits during playback safe, and editing during playback is now refused. **If the lock is ever loosened, that code has to come back** — the no-reload branch is only sound because a content change cannot have happened. The branch itself lives in `@sudobility/music_player` now; this package's edit lock is still what makes it sound, which is why it is documented here as well as there.

- **`Track.midiProgram` means two different things, and music_types'
  `domain/instruments/track-instrument.ts` is the only place that knows which**
  — a drum kit on a percussion track, an instrument everywhere else. The rule
  and `scoreWithResolvedKits` (run by music_editing's `setScore`) are recorded
  in music_types' CLAUDE.md.
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
  music_codecs, music_drawing, music_player, `immer` and `zod` — `vexflow` left
  with music_drawing. Without the guards nothing would notice a
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
- **Playback is bound to the store by an adapter, and the sound lives
  elsewhere.** `services/playback/adapter.ts` is what remains of
  `PlaybackController` after the engines, the transport and plan building moved
  to `@sudobility/music_player`. What stayed is everything that reads or writes
  editing state — the score subscription, the visible tracks, the selection and
  the caret — because a copy of the caret inside the player would be a second
  thing that can disagree with the first. So the player exposes primitives
  (`play`, `seek`, `setLoop`) and the adapter composes the score- and
  selection-aware operations: `togglePlay`, `seekToMeasure`, `previousMeasure`,
  `nextMeasure`, `setLoopFromSelection`.
- **This package imports `music_player` only through `/core`.** The root export
  resolves to the web entry, which constructs a synth; `/core` is the
  platform-free half — the interface, the singleton, the engine contract and the
  plan builders. `no-platform-imports.test.ts` asserts it, because a bare root
  import would make this package's own platform-free guarantee false. The old
  `platform/registry.ts` is gone: it existed to hold the playback engine, which
  now has its own singleton.
- **Everything stateless is still a parameter.** `XmlParser` and the codecs are
  function or constructor arguments rather than registry entries, so those stay
  testable with no global setup.
- **`vexflow` is music_drawing's**, which this package re-exports. It was never
  platform-bound — the canvas renderer draws into a 2D context the caller
  supplies, and was verified to render a full score with no DOM present at all —
  but drawing is not business logic.
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
- Export filenames come from music_codecs' `exportFilename` (keep the title, replace only what a filesystem refuses); the old `safeFilename` helpers are gone.
- **Modules that came here from music_editing, because they are not editing:** `services/playback/bind-player.ts` (`bindPlayer`, typed on music_player's `IMusicPlayer` — the structural `BindablePlayer` and the adapter's compile-time check against it are deleted; `TRANSPORT_SETTINGS_DEFAULTS` is beside it, `TransportSettings`/`PlayerFailure` are music_types'), `services/export/export-plan.ts` (`planExport`), `services/docs/` (`DOCS_TOPICS`, `RESOURCE_GROUPS`), `services/documents/unsaved-guard.ts` (`decideClose`/`decideQuit`) and `resolveThemeMode` (in `prefs.ts`). music_editing's guard keeps them from going back.
- **The theme, developer mode and developer settings are device prefs, and the editing ui slice no longer holds them.** `createDevicePrefsSlice` carries `themeMode`, `developerMode`, `devSettings` and their setters alongside the keyboard, font size and language, so the web app's composed store gets them from here; `createDevicePrefsStore` adds `pitchDisplay`, which stays in editing because note entry reads it. `EDITING_PREF_KEYS` is `['pitchDisplay']` — a document store no longer has a theme.
- **Vocabulary and types are music_types', not declared here** (`src/__moved-to-types.test.ts`, which also covers what arrived from music_editing typed there — `TransportSettings`/`PlayerFailure`, `WRITABLE_EXPORT_FORMATS`/`ExportPlan`, the docs and resource vocabularies, `THEME_MODES`): the generation option lists and draft types, `NewProjectSubmission` (music_client's `GeneratedProjectSubmission` was the same type and is gone), `LOCKABLE`, `REPLACE_PRESET_KEYS`/`ReplaceDraft`, `LabelledOption`, `TEMPLATE_IDS`/`TemplateCopy` (`ProjectTemplate` stays, it carries `build`), `FONT_SIZES`/`DevicePrefs`, `SaveState`, `DocumentOrigin`, `DocumentFileStorage`/`PrefsStorage`, `ToastSink`, `AppErrorCode`, `LibraryMessages`/`LibraryCopy` and `MidiImportPatch`. This package re-exports music_types, music_editing, music_codecs and music_drawing wholesale, so declaring or re-exporting one again reaches every consumer by two routes: a TS2308 in this build and a "Cannot redefine property" crash in a CommonJS consumer.

- **`hasVocalInstrument` is shared because both apps ask it twice** — once to decide whether to offer a lyrics control, once to decide whether adding a voice for the reader would be adding a second one. The *decision* is here; the list splice stays in each app, because the two hold their roster in different shapes (`{id, value}[]` on web, so the same instrument can appear twice and survive reordering; `string[]` on native). `GenerateScoreRequestDraft.lyrics` is dropped by `buildGenerateScoreRequest` unless the roster can actually sing — the server writes a lyric onto sung tracks and nothing else, so gating it only in the dialogs would leave a roster edited down to instruments still asking for words.

- **`lyricsTheme` is gated with `lyrics`, in the builder.** A subject for a lyric nobody asked for is exactly the disagreement the field was once left out to avoid, so it reaches the wire only alongside the words it describes and only over a roster that can sing them — one rule, in one place, rather than trusted at each app's call site. Blank is no theme.

## Related Projects

- `music_types` — shared types/schemas · `music_client` — network client · `music_api` — backend · `music_app` — web UI

## Git Workflow

- Do not use feature branches for code changes. Always stay on the current branch.
