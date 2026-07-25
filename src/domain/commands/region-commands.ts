/**
 * Region-replacement command factories (spec §12, §14): used by AI
 * regeneration acceptance (`replaceRegionCommand`) and by MIDI/MusicXML
 * import (`importScoreCommand`), both as a single undoable command per
 * spec §12 item 13 / §15.
 */
import { current } from 'immer';
import { replaceFragment } from '../score/fragment';
import type { ScoreFragment } from '../score/fragment';
import type { ScoreRange } from '../selection/types';
import type { Score } from '@sudobility/music_types';
import type { ScoreCommand } from './types';
import { snapshotCommand } from './snapshot';

/** 1-based inclusive [min, max] measure index label span across every track in `fragment`, or `null` if it has no measures. */
function measureIndexSpan(fragment: ScoreFragment): { first: number; last: number } | null {
  const indices = fragment.tracks.flatMap((t) => t.measures.map((m) => m.index));
  if (indices.length === 0) return null;
  return { first: Math.min(...indices) + 1, last: Math.max(...indices) + 1 };
}

/**
 * Replaces the measures overlapping `range` with `newFragment`'s content
 * (Task 3's `replaceFragment`), the single undoable command behind
 * accepting an AI-regenerated candidate (spec §12). `range` is the
 * authoritative target location (overriding `newFragment.range`, in case
 * a provider-returned fragment's own `range` is only a placeholder). The
 * label is derived from the fragment's own measure indices, so no `Score`
 * needs to be passed in at construction time.
 */
export function replaceRegionCommand(range: ScoreRange, newFragment: ScoreFragment): ScoreCommand {
  const fragment: ScoreFragment = { ...newFragment, range };
  const span = measureIndexSpan(fragment);
  const label = span ? `Regenerate measures ${span.first}–${span.last}` : 'Regenerate measures';

  return snapshotCommand(label, (draft) => {
    const next = replaceFragment(current(draft) as Score, fragment);
    Object.assign(draft, next);
  });
}

/**
 * Wholesale-replaces the current score with `newScore` (e.g. a freshly
 * imported MIDI/MusicXML file), as a single undoable command per spec
 * §15/§17.
 */
export function importScoreCommand(newScore: Score): ScoreCommand {
  return snapshotCommand('Import score', (draft) => {
    Object.assign(draft, newScore);
  });
}
