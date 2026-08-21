# @sudobility/music_lib

Business logic for the Moosiac music platform: score domain model with undoable commands, validation, quantization, VexFlow rendering adapter, Tone.js playback, MIDI/MusicXML import/export, and the Zustand app store.

## Installation

```bash
bun add @sudobility/music_lib @sudobility/music_types
```

Peer dependencies: `react ≥18`, `zustand ≥5`, `@tanstack/react-query ≥5`.

## Usage

```ts
import {
  createEmptyScore,
  addNoteCommand,
  HistoryManager,
  validateScore,
  VexFlowScoreRenderer,
  playbackController,
  useAppStore,
} from '@sudobility/music_lib';
```

## What's Inside

- **Domain** — score factories/queries, ScoreCommand factories + HistoryManager (undo/redo), validation (spec rules), quantization engine, voice allocation, tick/pitch math
- **Adapters** — VexFlow 4 notation renderer (virtualized), Tone.js playback engine + instruments, MIDI and MusicXML round-trip codecs
- **Store** — Zustand slices for score/selection/playback/generation/project/ui with memoized selectors
- **Workers** — off-thread MIDI parsing and quantization with inline fallbacks

## Development

```bash
bun install
bun run verify   # typecheck + lint + test (~990) + build
```

## License

BUSL-1.1
