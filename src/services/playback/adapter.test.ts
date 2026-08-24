/**
 * The adapter binds the store to the player. These pin what it must not lose.
 */
import { describe, expect, it, vi } from 'vitest';
import { getMusicPosition } from '@sudobility/music_types';
import { MockMusicPlayer } from '@sudobility/music_player/mocks';
import { testStoreContext } from '../../test/store-context.js';
import { createAppStore } from '../../store/useAppStore.js';
import { twinkleScore } from '../../test/fixtures.js';
import { createPlaybackAdapter } from './adapter.js';
import type { PlaybackStoreApi } from './adapter.js';

function makeStore(): PlaybackStoreApi {
  return createAppStore({ context: testStoreContext() });
}

describe('playback adapter', () => {
  it('loads the player when the store adopts a score', async () => {
    const store = makeStore();
    const player = new MockMusicPlayer();
    createPlaybackAdapter(player, store);

    store.getState().setScore(twinkleScore());
    await vi.waitFor(() =>
      expect(player.calls.some(c => c.startsWith('load'))).toBe(true)
    );
  });

  it('mirrors the player transport state into the store', () => {
    const store = makeStore();
    const player = new MockMusicPlayer();
    createPlaybackAdapter(player, store);

    player.emitTransport('playing');
    expect(store.getState().state).toBe('playing');
  });

  it('commits the final position to the caret when the transport stops', () => {
    const store = makeStore();
    const player = new MockMusicPlayer();
    createPlaybackAdapter(player, store);

    player.emitPosition(960);
    player.emitTransport('paused');

    // "Play from the caret" rests on the two coinciding whenever the transport
    // is not running.
    expect(getMusicPosition().reportedTick).toBe(960);
  });

  it('seeks by moving the one position, and does not also tell the player', () => {
    // Telling it as well would be two writes of one number. A real player
    // subscribes to the position and follows a move on its own — that is
    // music_player's contract and is tested there; this mock does not, which
    // is exactly why `calls` stays empty here.
    const store = makeStore();
    const player = new MockMusicPlayer();
    const adapter = createPlaybackAdapter(player, store);
    store.getState().setScore(twinkleScore());

    adapter.seek(480);

    expect(getMusicPosition().reportedTick).toBe(480);
    expect(player.calls).not.toContain('seek(480)');
  });

  it('clears the selection on the ->playing transition only', async () => {
    const store = makeStore();
    const player = new MockMusicPlayer();
    const adapter = createPlaybackAdapter(player, store);
    store.getState().setScore(twinkleScore());

    await adapter.togglePlay();
    expect(player.calls).toContain('play');

    // Pausing deliberately leaves the selection alone, so pausing to edit keeps
    // what you had selected.
    player.emitTransport('playing');
    await adapter.togglePlay();
    expect(player.calls).toContain('pause');
  });

  it('routes synth load progress into the store', () => {
    const store = makeStore();
    const player = new MockMusicPlayer();
    createPlaybackAdapter(player, store);

    player.emitLoadState({ status: 'loading', fraction: 0.45 });
    expect(store.getState().synthLoad.status).toBe('loading');
  });
});
