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
export * from './domain/score/factory';
export * from './domain/score/queries';
export * from './domain/score/ties';
export * from './domain/score/fragment';
export * from './domain/score/ids';

// domain/selection
export * from './domain/selection/types';
export * from './domain/selection/selection';

// domain/commands
export * from './domain/commands/types';
export * from './domain/commands/history';
export * from './domain/commands/snapshot';
export * from './domain/commands/reflow';
export * from './domain/commands/note-commands';
export * from './domain/commands/structure-commands';
export * from './domain/commands/edit-commands';
export * from './domain/commands/region-commands';

// domain/validation
export * from './domain/validation/issues';
export * from './domain/validation/validator';

// domain/quantization
export * from './domain/quantization/options';
export * from './domain/quantization/quantize';

// domain/voicing
export * from './domain/voicing/allocate';

// domain/time
export * from './domain/time/fraction';
export * from './domain/time/ticks';
export * from './domain/time/tempo-map';
export * from './domain/time/durations';

// domain/pitch
export * from './domain/pitch/pitch';
export * from './domain/pitch/transpose';

// test fixtures (deterministic score builders — used by downstream test suites)
export * from './test/fixtures';

// adapters/vexflow
export * from './adapters/vexflow/types';
export * from './adapters/vexflow/renderer';
export * from './adapters/vexflow/convert';
export * from './adapters/vexflow/layout';
export * from './adapters/vexflow/id-map';

// adapters/tone
export * from './adapters/tone/instruments';
export * from './adapters/tone/tone-engine';
export * from './adapters/tone/schedule';
export * from './adapters/tone/midi';

// adapters/midi
export * from './adapters/midi/analyze';
export * from './adapters/midi/import';
export * from './adapters/midi/import-options';
export * from './adapters/midi/export';
export * from './adapters/midi/measures';
export * from './adapters/midi/key-detection';

// adapters/musicxml
export * from './adapters/musicxml/import';
export { escapeXml, exportMusicXml } from './adapters/musicxml/export';
export * from './adapters/musicxml/duration-map';

// services
export * from './services/errors';
export * from './services/generation/registry';
export * from './services/generation/validate-response';
export * from './services/import-export/download';
export * from './services/import-export/midi-service';
export * from './services/import-export/musicxml-service';
export * from './services/perf/benchmark';
export * from './services/persistence/db';
export * from './services/persistence/projects';
export * from './services/persistence/samples';
export * from './services/persistence/settings';
export * from './services/persistence/autosave';
export * from './services/persistence/migrations';
export * from './services/playback/types';
export * from './services/playback/controller';
export * from './services/quantization/quantize-service';
export * from './services/regeneration/controller';

// store
export * from './store/useAppStore';
export * from './store/selectors';
