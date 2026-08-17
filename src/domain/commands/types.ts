/**
 * Command-based undo/redo (spec §14). A `ScoreCommand` is pure: `execute`
 * and `undo` each take a `Score` and return a new `Score`, never mutating
 * their input, holding a store reference, or performing I/O.
 */
import type { Score } from '@sudobility/music_types';

/**
 * Whether a command changes the music or only how it is mixed.
 *
 * The distinction exists for one reason: content is immutable while the
 * transport is playing (see `store/slices/score-slice.ts`), and mixing is not
 * editing — muting a part while listening is how an arrangement gets listened
 * to. `services/playback/controller.ts` relies on it too: while playing, the
 * only score change that can reach it is a mix change, which is what lets it
 * push levels to the engine instead of reloading and resuming.
 */
export type CommandKind = 'content' | 'mix';

export type ScoreCommand = {
  id: string;
  label: string;
  timestamp: number;
  /**
   * Required rather than optional on purpose: a command written later without
   * thinking about the playback lock should be refused while playing, not
   * admitted by a convenient default.
   */
  kind: CommandKind;
  execute(score: Score): Score;
  undo(score: Score): Score;
};
