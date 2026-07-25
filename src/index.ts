/**
 * @sudobility/music_lib — ScoreSmith business logic.
 *
 * Domain layer (framework-free): score model factories/queries, undoable
 * commands + history, validation, quantization, voice allocation,
 * selection helpers, time/pitch math. Types and schemas come from
 * @sudobility/music_types (re-exported by the relevant modules for
 * convenience). Adapters (VexFlow/Tone/MIDI/MusicXML), services, and the
 * Zustand store are exported from here as well (added incrementally).
 */

// domain/score
export * from './domain/score/factory.js';
export * from './domain/score/queries.js';
export * from './domain/score/ties.js';
export * from './domain/score/fragment.js';
export * from './domain/score/ids.js';

// domain/selection
export * from './domain/selection/types.js';
export * from './domain/selection/selection.js';

// domain/commands
export * from './domain/commands/types.js';
export * from './domain/commands/history.js';
export * from './domain/commands/snapshot.js';
export * from './domain/commands/reflow.js';
export * from './domain/commands/note-commands.js';
export * from './domain/commands/structure-commands.js';
export * from './domain/commands/edit-commands.js';
export * from './domain/commands/region-commands.js';

// domain/validation
export * from './domain/validation/issues.js';
export * from './domain/validation/validator.js';

// domain/quantization
export * from './domain/quantization/options.js';
export * from './domain/quantization/quantize.js';

// domain/voicing
export * from './domain/voicing/allocate.js';

// domain/time
export * from './domain/time/fraction.js';
export * from './domain/time/ticks.js';
export * from './domain/time/tempo-map.js';
export * from './domain/time/durations.js';

// domain/pitch
export * from './domain/pitch/pitch.js';
export * from './domain/pitch/transpose.js';

// test fixtures (deterministic score builders — used by downstream test suites)
export * from './test/fixtures.js';

// adapters/vexflow
export * from './adapters/vexflow/types.js';
export * from './adapters/vexflow/renderer.js';
export * from './adapters/vexflow/convert.js';
export * from './adapters/vexflow/layout.js';
export * from './adapters/vexflow/id-map.js';

// adapters/tone
export * from './adapters/tone/instruments.js';
export * from './adapters/tone/tone-engine.js';
export * from './adapters/tone/schedule.js';
export * from './adapters/tone/midi.js';

// adapters/midi
export * from './adapters/midi/analyze.js';
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
export * from './services/import-export/download.js';
export * from './services/import-export/midi-service.js';
export * from './services/import-export/musicxml-service.js';
export * from './services/perf/benchmark.js';
export * from './services/persistence/autosave.js';
export * from './services/playback/types.js';
export * from './services/playback/controller.js';
export * from './services/quantization/quantize-service.js';
export * from './services/regeneration/controller.js';

// store
export * from './store/context.js';
export * from './services/prefs.js';
export * from './templates/index.js';
export * from './store/useAppStore.js';
export * from './store/selectors.js';
