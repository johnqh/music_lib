# @sudobility/music_lib

Business logic for ScoreSmith (the Sudobility music app family): the entire non-UI layer — score domain model, undoable commands, validation, quantization, rendering/audio/file adapters, and the Zustand app store.

## Tech Stack

- TypeScript (strict), ESM, built with plain `tsc -p tsconfig.build.json` (relative imports only — no path aliases; dist is bundler-consumed)
- Types/schemas from `@sudobility/music_types`
- VexFlow 4 (notation SVG), Tone.js 15 (audio), @tonejs/midi, Zustand 5 + Immer, Zod 4
- Bun for scripts, vitest + jsdom for tests (`src/test/setup.ts` stubs `SVGElement.getBBox` for VexFlow)
- Published to npm as `@sudobility/music_lib` (restricted) via CI on push to main

## Commands

- `bun install` — install dependencies
- `bun run verify` — typecheck + lint + test + build (run before any push; ~990 tests)
- `bun run test` / `bun run test:watch` — vitest
- `bun run build` — emit `dist/`

## Structure

- `src/domain/` — framework-free core: `score/` (factories, queries, ties, fragments, ids), `commands/` (ScoreCommand factories, HistoryManager, reflow), `validation/`, `quantization/`, `voicing/`, `selection/`, `time/` (fractions/ticks/tempo/durations), `pitch/`
- `src/adapters/` — `vexflow/` (ScoreRenderer), `tone/` (playback engine + instruments), `midi/`, `musicxml/`
- `src/services/` — playback controller singleton, generation registry, persistence (Dexie — being replaced by music_client in Phase 2), import-export, quantize worker service, errors, benchmark
- `src/store/` — Zustand slices (score/selection/playback/generation/project/ui) + memoized selectors
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

- `dist/` uses extensionless relative imports (plain tsc): resolvable by bundlers and Bun, NOT by raw Node ESM
- The playback controller is a module-level singleton that constructs Tone objects at import — component tests in consuming apps must mock it
- Two `safeFilename` helpers existed (midi/musicxml); the package root re-exports the midi one only

## Related Projects

- `music_types` — shared types/schemas · `music_client` — network client · `music_api` — backend · `music_app` — web UI
