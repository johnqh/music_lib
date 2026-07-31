/**
 * Playback contracts now live in `@sudobility/music_types`, so `music_io` can
 * implement them without depending on this package and this package can drive
 * playback without knowing which platform it is on.
 *
 * Re-exported here so existing importers keep one import site.
 */
export type {
  PlaybackEngine,
  PlaybackObserver,
  TransportPlaybackState,
} from '@sudobility/music_types';
