# @sudobility/music_lib

Frontend logic for the Moosiac music platform: app-side generation request helpers, rendering/audio/file adapters, and the Zustand app store. Shared score/domain/generation contracts live in `@sudobility/music_types`.

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

- **Frontend helpers** — generation request builders and app-facing helpers around the shared score/domain contracts
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
