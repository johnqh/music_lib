import { afterEach, describe, expect, it } from 'vitest';
import { MockPlaybackEngine } from '@sudobility/music_io/mocks';
import {
  PlatformNotInitializedError,
  getMusicPlatform,
  initializeMusicPlatform,
  resetMusicPlatform,
} from './registry.js';

afterEach(() => resetMusicPlatform());

describe('music platform registry', () => {
  it('returns what was registered', () => {
    const playback = new MockPlaybackEngine();
    initializeMusicPlatform({ playback });
    expect(getMusicPlatform().playback).toBe(playback);
  });

  it('names itself when nothing is registered, rather than failing later with a null', () => {
    expect(() => getMusicPlatform()).toThrow(PlatformNotInitializedError);
    expect(() => getMusicPlatform()).toThrow(/initializeMusicPlatform/);
  });

  it('lets a test replace the platform', () => {
    initializeMusicPlatform({ playback: new MockPlaybackEngine() });
    const replacement = new MockPlaybackEngine();
    initializeMusicPlatform({ playback: replacement });
    expect(getMusicPlatform().playback).toBe(replacement);
  });
});
