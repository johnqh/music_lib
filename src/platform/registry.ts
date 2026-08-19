/**
 * The one platform service music_lib holds globally.
 *
 * Only playback is here, because only playback is a long-lived singleton whose
 * users (`playbackController`) are reached through a module import rather than
 * a call chain. The stateless services — XML parsing, the MIDI codec — are
 * passed to the pure adapter functions that need them, which keeps those
 * functions testable with no global setup at all.
 *
 * Implementations come from `@sudobility/music_io`; nothing in this package
 * knows which platform it is running on.
 */
import type { PlaybackEngine } from '@sudobility/music_types';

export type MusicPlatform = { playback: PlaybackEngine };

export class PlatformNotInitializedError extends Error {
  constructor() {
    super(
      'The music platform has not been initialized. Call initializeMusicPlatform() from your app composition root before using playback.'
    );
    this.name = 'PlatformNotInitializedError';
  }
}

let platform: MusicPlatform | null = null;

export function initializeMusicPlatform(next: MusicPlatform): void {
  platform = next;
}

export function getMusicPlatform(): MusicPlatform {
  if (!platform) throw new PlatformNotInitializedError();
  return platform;
}

/** Test-only: clears the registry so suites cannot leak into each other. */
export function resetMusicPlatform(): void {
  platform = null;
}
