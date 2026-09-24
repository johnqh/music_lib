/**
 * Unplugged mode's arrangement defaults and mix formula now live in
 * `@sudobility/music_types` (`domain/unplugged/unplugged.ts`), beside the
 * `UnpluggedListener`/`UnpluggedPoint`/`UnpluggedArrangement` types they
 * are the policy over — they import nothing but that package, and the
 * Spatial view's engine (`music_spatial_core`) needs them without needing
 * the rest of this library. Re-exported here so every existing consumer of
 * `music_lib` keeps the same import.
 */
export {
  UNPLUGGED_RADIUS,
  defaultUnpluggedListener,
  defaultUnpluggedTrackPositions,
  effectiveUnpluggedArrangement,
  unpluggedMixFor,
  unpluggedMixes,
} from '@sudobility/music_types';
export type {
  EffectiveUnpluggedArrangement,
  UnpluggedMix,
} from '@sudobility/music_types';
