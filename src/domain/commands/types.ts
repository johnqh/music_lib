/**
 * Command-based undo/redo (spec §14). A `ScoreCommand` is pure: `execute`
 * and `undo` each take a `Score` and return a new `Score`, never mutating
 * their input, holding a store reference, or performing I/O.
 */
import type { Score } from '@sudobility/music_types';

export type ScoreCommand = {
  id: string;
  label: string;
  timestamp: number;
  execute(score: Score): Score;
  undo(score: Score): Score;
};
