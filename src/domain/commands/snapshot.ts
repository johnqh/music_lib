/**
 * Generic `ScoreCommand` builders backed by Immer patches (Task 5 brief).
 * `snapshotCommand` records, at each `execute` call, the forward/inverse
 * patches between the score it's given and the result of running `mutate`
 * over an Immer draft of it; `undo` replays the inverse patches. Because
 * Immer's patches are derived mechanically from the actual before/after
 * trees, `execute` then `undo` is guaranteed to reproduce a deep-equal
 * score for *any* `mutate`, however structurally involved — command
 * factories don't need to hand-write inverse logic.
 *
 * `execute` is re-run (recomputing patches against whatever score it's
 * given) every time it's called, so a command replayed via
 * `HistoryManager.redo` after an intervening `undo` still produces correct
 * patches for a subsequent `undo`, as long as `undo` is always called with
 * the exact score `execute` most recently returned (the standard linear
 * undo-stack contract `HistoryManager` relies on).
 */
import type { Draft, Patch } from 'immer';
import { applyPatches, current, enablePatches, produceWithPatches } from 'immer';
import { createId } from '../score/ids';
import type { Score } from '@sudobility/music_types';
import type { ScoreCommand } from './types';

enablePatches();

/**
 * Builds a `ScoreCommand` whose forward/inverse changes are computed by
 * running `mutate` over an Immer draft of the score. `label` is fixed at
 * construction time (per `ScoreCommand`); `mutate` may close over whatever
 * parameters the command needs (event ids, new values, etc.), captured at
 * construction.
 */
export function snapshotCommand(label: string, mutate: (draft: Draft<Score>) => void): ScoreCommand {
  let inversePatches: Patch[] | null = null;

  return {
    id: createId(),
    label,
    timestamp: Date.now(),
    execute(score: Score): Score {
      const [next, , inverse] = produceWithPatches(score, mutate);
      inversePatches = inverse;
      return next;
    },
    undo(score: Score): Score {
      if (!inversePatches) return score;
      return applyPatches(score, inversePatches);
    },
  };
}

/**
 * Convenience wrapper over `snapshotCommand` for the common case where a
 * command's actual logic is easiest to write as an ordinary pure
 * `(Score) => Score` function (most factories in this module): `transform`
 * runs against a plain snapshot of the current draft (via Immer's
 * `current`), and its result is adopted wholesale as the new draft state,
 * so `mutate`'s Immer-facing bookkeeping stays out of each factory.
 */
export function transformCommand(label: string, transform: (score: Score) => Score): ScoreCommand {
  return snapshotCommand(label, (draft) => {
    const next = transform(current(draft) as Score);
    Object.assign(draft, next);
  });
}
