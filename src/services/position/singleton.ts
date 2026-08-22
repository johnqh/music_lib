/**
 * The music-position singleton.
 *
 * Same shape as the rest of the family's services (see `@sudobility/di`'s
 * storage and network singletons): initialise once at start-up, read it
 * everywhere, reset it in tests.
 *
 * A singleton because the playhead *is* global to a running transport — there
 * is one piece of music playing, and the whole point of this type is that
 * everything following it reads the same number. Two instances would
 * reintroduce exactly the disagreement it exists to prevent.
 */
import type {
  IMusicPosition,
  IMusicPositionSource,
} from '@sudobility/music_types';
import { MusicPosition } from './music-position.js';

let instance: IMusicPositionSource | null = null;

/**
 * Creates the singleton if it does not exist.
 *
 * Idempotent, so a second call from a re-mounting composition root does not
 * silently swap the playhead out from under everything subscribed to it.
 */
export function initializeMusicPosition(
  override?: IMusicPositionSource
): IMusicPositionSource {
  if (!instance) instance = override ?? new MusicPosition();
  return instance;
}

/**
 * The writable playhead, for whatever is driving the transport.
 *
 * Auto-initialises rather than throwing: unlike a storage service there is no
 * configuration to get wrong, and a playhead that refuses to exist until
 * somebody remembers a start-up call is a worse failure than one that starts
 * at zero.
 */
export function getMusicPositionSource(): IMusicPositionSource {
  return initializeMusicPosition();
}

/** The read-only playhead, for anything that follows the music. */
export function getMusicPosition(): IMusicPosition {
  return initializeMusicPosition();
}

/** Drops the singleton. Tests only — a suite must not inherit the last one's playhead. */
export function resetMusicPosition(): void {
  instance = null;
}
