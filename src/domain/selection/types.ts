/**
 * Selection model (spec §9). The `ScoreRange`/`ScoreSelection` types are
 * canonical in @sudobility/music_types and re-exported here so domain
 * modules keep one import site; `emptySelection` is the runtime helper.
 */
export type { ScoreRange, ScoreSelection } from '@sudobility/music_types';
import type { ScoreSelection } from '@sudobility/music_types';

/** An empty selection: no events, measures, tracks, or range selected. */
export function emptySelection(): ScoreSelection {
  return { eventIds: [], measureIds: [], trackIds: [] };
}
