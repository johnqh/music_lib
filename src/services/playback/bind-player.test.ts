import { afterEach, describe, expect, it, vi } from 'vitest';
import { twoTrackScore } from '@sudobility/music_types/test';
import {
  getMusicPosition,
  getMusicPositionSource,
  resetMusicPosition,
  scoreEndTick,
} from '@sudobility/music_types';
import type {
  PlaybackLoadState,
  Score,
  ScoreRange,
  TransportPlaybackState,
  TransportSettings,
} from '@sudobility/music_types';
import type { IMusicPlayer } from '@sudobility/music_player/core';
import { createEditingStore } from '@sudobility/music_editing';
import type { EditingState, EditingStoreApi } from '@sudobility/music_editing';
import { bindPlayer } from './bind-player.js';

/** A bare editing store, built the way a document is — no context, no server. */
function testEditingStore(score?: Score) {
  const store = createEditingStore();
  if (score) store.getState().setScore(score);
  // The binder writes the transport settings into whichever store it is given.
  return store as unknown as EditingStoreApi<
    EditingState & Partial<TransportSettings>
  >;
}

/** The part of the player the binder uses; the rest is left out on purpose. */
type Bound = Pick<
  IMusicPlayer,
  | 'load'
  | 'play'
  | 'pause'
  | 'stop'
  | 'setLoop'
  | 'setTempoMultiplier'
  | 'setMetronome'
  | 'setMasterVolume'
  | 'setVisibleTracks'
  | 'onTransport'
  | 'onLoadState'
>;

type Fake = IMusicPlayer & {
  emitTransport: (state: TransportPlaybackState) => void;
  emitLoad: (state: PlaybackLoadState) => void;
  calls: Record<string, unknown[][]>;
};

function fakePlayer(overrides: Partial<Bound> = {}): Fake {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  // Sets, as a real player keeps: two bindings on one player both listen.
  const transport = new Set<(s: TransportPlaybackState) => void>();
  const load = new Set<(s: PlaybackLoadState) => void>();
  const player: Bound & Omit<Fake, keyof IMusicPlayer> = {
    load: vi.fn(async (...args: unknown[]) => record('load')(...args)),
    play: vi.fn(async () => record('play')()),
    pause: record('pause'),
    stop: record('stop'),
    setLoop: record('setLoop') as (r: ScoreRange | null) => void,
    setTempoMultiplier: record('setTempoMultiplier'),
    setMetronome: record('setMetronome'),
    setMasterVolume: record('setMasterVolume'),
    setVisibleTracks: record('setVisibleTracks'),
    onTransport: fn => {
      transport.add(fn);
      return () => transport.delete(fn);
    },
    onLoadState: fn => {
      load.add(fn);
      return () => load.delete(fn);
    },
    ...overrides,
    emitTransport: s => transport.forEach(fn => fn(s)),
    emitLoad: s => load.forEach(fn => fn(s)),
    calls,
  };
  return player as unknown as Fake;
}

afterEach(() => resetMusicPosition());

describe('bindPlayer', () => {
  it('loads the score it is bound to, and each new score after', () => {
    const store = testEditingStore(twoTrackScore());
    const player = fakePlayer();
    bindPlayer(player, store);
    expect(player.calls.load).toHaveLength(1);
    expect(player.calls.load![0]![0]).toBe(store.getState().score);

    store.getState().setScore(twoTrackScore());
    expect(player.calls.load).toHaveLength(2);
  });

  it('mirrors the transport and the synth load into the store', () => {
    const store = testEditingStore(twoTrackScore());
    const player = fakePlayer();
    bindPlayer(player, store);
    player.emitTransport('playing');
    expect(store.getState().state).toBe('playing');
    player.emitLoad({ status: 'loading', fraction: 0.5 });
    expect(store.getState().synthLoad).toEqual({
      status: 'loading',
      fraction: 0.5,
    });
  });

  it('pushes visible tracks without reloading', () => {
    const store = testEditingStore(twoTrackScore());
    const player = fakePlayer();
    bindPlayer(player, store);
    const [first] = store.getState().score!.tracks;
    store.getState().setVisibleTracks([first!.id]);
    expect(player.calls.setVisibleTracks).toEqual([[[first!.id]]]);
    expect(player.calls.load).toHaveLength(1);
  });

  it('clears the selection on play, and pauses when already playing', async () => {
    const store = testEditingStore(twoTrackScore());
    const player = fakePlayer();
    const binding = bindPlayer(player, store);
    const [first] = store.getState().score!.tracks;
    store.getState().selectTrack(first!.id);

    await binding.togglePlay();
    expect(player.calls.play).toHaveLength(1);
    expect(store.getState().selection.trackIds).toEqual([]);

    store.getState().selectTrack(first!.id);
    player.emitTransport('playing');
    await binding.togglePlay();
    expect(player.calls.pause).toHaveLength(1);
    // Pausing to edit keeps what was selected.
    expect(store.getState().selection.trackIds).toEqual([first!.id]);
  });

  it('reports a failure to play or load through the error hook', async () => {
    const store = testEditingStore(twoTrackScore());
    const onError = vi.fn();
    const failure = new Error('no synth');
    const binding = bindPlayer(
      fakePlayer({
        play: async () => {
          throw failure;
        },
        load: async () => {
          throw failure;
        },
      }),
      store,
      { onError }
    );
    await Promise.resolve();
    await binding.togglePlay();
    expect(onError).toHaveBeenCalledWith('scoreLoadFailed', failure);
    expect(onError).toHaveBeenCalledWith('playbackFailed', failure);
  });

  it('loops the selection, else the whole score, and a second press clears', () => {
    const store = testEditingStore(twoTrackScore());
    const player = fakePlayer();
    const binding = bindPlayer(player, store);
    const score = store.getState().score!;

    binding.toggleLoop();
    expect(store.getState().loopRange).toEqual({
      startTick: 0,
      endTick: scoreEndTick(score),
      trackIds: [],
    });
    expect(player.calls.setLoop).toHaveLength(1);

    binding.toggleLoop();
    expect(store.getState().loopRange).toBeNull();

    const bar2 = score.tracks[0]!.measures[1]!;
    store.getState().selectMeasures([bar2.id]);
    binding.toggleLoop();
    expect(store.getState().loopRange?.startTick).toBe(bar2.startTick);
  });

  it('steps a bar at a time, clamped at both ends', () => {
    const store = testEditingStore(twoTrackScore());
    const binding = bindPlayer(fakePlayer(), store);
    const measures = store.getState().score!.tracks[0]!.measures;

    binding.nextMeasure();
    expect(getMusicPosition().reportedTick).toBe(measures[1]!.startTick);
    binding.previousMeasure();
    binding.previousMeasure();
    expect(getMusicPosition().reportedTick).toBe(0);

    getMusicPositionSource().moveTo(measures.at(-1)!.startTick);
    binding.nextMeasure();
    expect(getMusicPosition().reportedTick).toBe(measures.at(-1)!.startTick);

    binding.seek(-5);
    expect(getMusicPosition().reportedTick).toBe(0);
  });

  it('keeps speed, metronome and volume in the store as well as the player', () => {
    const store = testEditingStore(twoTrackScore());
    const player = fakePlayer();
    const binding = bindPlayer(player, store);
    binding.setTempoMultiplier(1.5);
    binding.setMetronome(true);
    binding.setMasterVolume(0.25);
    expect(store.getState()).toMatchObject({
      tempoMultiplier: 1.5,
      metronome: true,
      masterVolume: 0.25,
    });
    expect(player.calls.setTempoMultiplier).toEqual([[1.5]]);
  });

  it('pauses what it is playing when it unbinds, and nothing else', () => {
    // Leaving a published page, or a tab, must not leave its music running
    // under a screen that is not showing it.
    const store = testEditingStore(twoTrackScore());
    const player = fakePlayer();
    const binding = bindPlayer(player, store);
    player.emitTransport('playing');
    binding.unbind();
    expect(player.calls.pause).toHaveLength(1);

    const idle = testEditingStore(twoTrackScore());
    const other = fakePlayer();
    bindPlayer(other, idle).unbind();
    expect(other.calls.pause ?? []).toHaveLength(0);
  });

  describe('two stores on one player', () => {
    /*
      A player is app-wide and a binding is not: the published page binds its
      own store while the editor's binding stays alive underneath it (a pushed
      screen on the native app, the app-wide adapter on the web). Each binding
      loads only when its own score changes, so coming back to the editor found
      the published piece still in the player and played that.
    */
    it('reloads its own score before playing when another binding loaded since', async () => {
      const editor = testEditingStore(twoTrackScore());
      const published = testEditingStore(twoTrackScore());
      const player = fakePlayer();
      const editorBinding = bindPlayer(player, editor);
      bindPlayer(player, published);
      expect(player.calls.load!.at(-1)![0]).toBe(published.getState().score);

      await editorBinding.togglePlay();
      expect(player.calls.load!.at(-1)![0]).toBe(editor.getState().score);
      expect(player.calls.play).toHaveLength(1);
    });

    it('does not reload when its score is already the one loaded', async () => {
      const store = testEditingStore(twoTrackScore());
      const player = fakePlayer();
      const binding = bindPlayer(player, store);
      await binding.togglePlay();
      expect(player.calls.load).toHaveLength(1);
    });

    it('mirrors the transport only into the store whose score is playing', () => {
      const editor = testEditingStore(twoTrackScore());
      const published = testEditingStore(twoTrackScore());
      const player = fakePlayer();
      bindPlayer(player, editor);
      bindPlayer(player, published);
      player.emitTransport('playing');
      expect(published.getState().state).toBe('playing');
      // The editor is not what is sounding, so it is not locked as though it were.
      expect(editor.getState().state).toBe('stopped');
    });

    it('leaves hidden tracks to the binding whose score is loaded', () => {
      const editor = testEditingStore(twoTrackScore());
      const published = testEditingStore(twoTrackScore());
      const player = fakePlayer();
      bindPlayer(player, editor);
      bindPlayer(player, published);
      const [first] = editor.getState().score!.tracks;
      editor.getState().setVisibleTracks([first!.id]);
      expect(player.calls.setVisibleTracks ?? []).toHaveLength(0);
    });
  });

  it('stops listening once unbound, and leaves the player alive', () => {
    const store = testEditingStore(twoTrackScore());
    const player = fakePlayer();
    const binding = bindPlayer(player, store);
    binding.unbind();
    player.emitTransport('playing');
    store.getState().setScore(twoTrackScore());
    expect(store.getState().state).toBe('stopped');
    expect(player.calls.load).toHaveLength(1);
  });
});
