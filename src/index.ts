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
