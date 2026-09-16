/**
 * One store per open document, saved by the same rules whichever origin it has.
 *
 * A local file and a server project are the same object with two backings: the
 * editing, the undo, the dirty flag, the save state and the debounce are
 * shared, and only where the bytes go differs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindPlayer } from '../services/playback/bind-player.js';
import { parseProjectFile } from '@sudobility/music_codecs';
import {
  addMeasureCommand,
  getMusicPosition,
  getMusicPositionSource,
} from '@sudobility/music_types';
import { MockMusicPlayer } from '@sudobility/music_player/mocks';
import { testStoreContext } from '../test/store-context.js';
import { threeTrackScore, twinkleScore } from '../test/fixtures.js';
import {
  adoptOutsideScore,
  createDocumentStore,
  openFileDocument,
  openProjectDocument,
} from './document-store.js';
import type { DocumentFileStorage, Toast } from '@sudobility/music_types';

const DEBOUNCE_MS = 2000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

class MemoryFiles implements DocumentFileStorage {
  readonly files = new Map<string, string>();
  writes = 0;
  failNext = 0;
  gate: Promise<void> | null = null;

  async readText(uri: string): Promise<string> {
    const text = this.files.get(uri);
    if (text === undefined) throw new Error(`No file at ${uri}`);
    return text;
  }

  async writeText(uri: string, text: string): Promise<void> {
    this.writes += 1;
    if (this.gate) await this.gate;
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('Disk went away');
    }
    this.files.set(uri, text);
  }
}

function toastSink() {
  const toasts: Toast[] = [];
  return {
    toasts,
    sink: { push: (t: Toast) => toasts.push(t), dismiss: () => {} },
  };
}

describe('a local file document', () => {
  it('autosaves the project file to where it lives, then is clean', async () => {
    const files = new MemoryFiles();
    const store = createDocumentStore({
      score: twinkleScore(),
      title: 'Twinkle',
      origin: { kind: 'file', uri: '/docs/Twinkle.moo' },
      files,
    });
    expect(store.getState().dirty).toBe(false);

    store.getState().dispatchCommand(addMeasureCommand('Add measure'));
    expect(store.getState().dirty).toBe(true);
    expect(files.writes).toBe(0);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
    const saved = parseProjectFile(files.files.get('/docs/Twinkle.moo')!);
    expect(saved.title).toBe('Twinkle');
    expect(saved.score.tracks[0]!.measures.length).toBe(
      store.getState().score!.tracks[0]!.measures.length
    );
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().saveState).toBe('saved');
  });

  it('is never autosaved before it has somewhere to go', async () => {
    const files = new MemoryFiles();
    const store = createDocumentStore({
      score: twinkleScore(),
      title: 'Scratch',
      files,
    });
    store.getState().dispatchCommand(addMeasureCommand('Add measure'));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
    await store.getState().saveNow();
    expect(files.writes).toBe(0);
    expect(store.getState().dirty).toBe(true);
  });

  it('Save As writes there, moves the document there, and leaves it clean', async () => {
    const files = new MemoryFiles();
    const onSaved = vi.fn();
    const store = createDocumentStore({
      score: twinkleScore(),
      title: 'Scratch',
      files,
      onSaved,
    });
    store.getState().dispatchCommand(addMeasureCommand('Add measure'));

    await store.getState().saveAs('/docs/Scratch.moo');

    expect(store.getState().origin).toEqual({
      kind: 'file',
      uri: '/docs/Scratch.moo',
    });
    expect(files.files.has('/docs/Scratch.moo')).toBe(true);
    expect(store.getState().dirty).toBe(false);
    expect(onSaved).toHaveBeenCalledWith({
      origin: { kind: 'file', uri: '/docs/Scratch.moo' },
      title: 'Scratch',
    });
  });

  it('Save As writes even a clean document', async () => {
    const files = new MemoryFiles();
    const store = createDocumentStore({
      score: twinkleScore(),
      title: 'Clean',
      files,
    });
    await store.getState().saveAs('/docs/Clean.moo');
    expect(files.files.has('/docs/Clean.moo')).toBe(true);
  });

  it('a failed write keeps it dirty and says so through the sink', async () => {
    const files = new MemoryFiles();
    const { toasts, sink } = toastSink();
    const store = createDocumentStore({
      score: twinkleScore(),
      title: 'T',
      origin: { kind: 'file', uri: '/t.moo' },
      files,
      context: { toasts: sink },
    });
    files.failNext = 1;
    store.getState().dispatchCommand(addMeasureCommand('Add measure'));
    await expect(store.getState().saveNow()).rejects.toThrow('Disk went away');

    expect(store.getState().dirty).toBe(true);
    expect(store.getState().saveState).toBe('unsaved');
    expect(toasts.map(t => t.severity)).toEqual(['error']);
  });

  it('stays dirty when a change that is not the score lands mid-write', async () => {
    // Hiding a track leaves the score's identity alone, so identity alone
    // would call this document saved. The revision is what notices.
    const files = new MemoryFiles();
    const store = createDocumentStore({
      score: threeTrackScore(),
      title: 'T',
      origin: { kind: 'file', uri: '/t.moo' },
      files,
    });
    let release!: () => void;
    files.gate = new Promise(resolve => (release = resolve));

    store.getState().dispatchCommand(addMeasureCommand('Add measure'));
    const saving = store.getState().saveNow();
    await vi.advanceTimersByTimeAsync(0);
    store.getState().setVisibleTracks([store.getState().score!.tracks[0]!.id]);
    release();
    await saving;

    expect(store.getState().dirty).toBe(true);
    expect(store.getState().saveState).toBe('unsaved');
  });

  it('renaming is an edit, and the new title is what gets written', async () => {
    const files = new MemoryFiles();
    const store = createDocumentStore({
      score: twinkleScore(),
      title: 'Old',
      origin: { kind: 'file', uri: '/o.moo' },
      files,
    });
    store.getState().rename('New');
    expect(store.getState().dirty).toBe(true);
    await store.getState().saveNow();
    expect(parseProjectFile(files.files.get('/o.moo')!).title).toBe('New');
  });

  it('opens a file in either shape the apps have written', async () => {
    const files = new MemoryFiles();
    files.files.set(
      '/web.json',
      JSON.stringify({
        name: 'From web',
        schemaVersion: 1,
        score: twinkleScore(),
      })
    );
    const store = await openFileDocument(files, '/web.json');
    expect(store.getState().title).toBe('From web');
    expect(store.getState().origin).toEqual({ kind: 'file', uri: '/web.json' });
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().dirty).toBe(false);
  });

  it('has no server, and says so', () => {
    const store = createDocumentStore({ score: twinkleScore(), title: 'T' });
    expect(store.getState().serverAvailable).toBe(false);
  });
});

describe('a server project document', () => {
  it('opens with the server version, the generation record and the view prefs', async () => {
    const context = testStoreContext();
    const created = await context.fakeClient.createProject(
      {
        name: 'Quartet',
        score: threeTrackScore(),
        uiPrefs: { zoom: 1.5 },
      },
      't'
    );
    const trackId = threeTrackScore().tracks[1]!.id;
    await context.fakeClient.updateProject(
      created.id,
      { uiPrefs: { zoom: 1.5, visibleTrackIds: [trackId] } },
      't'
    );
    const record = context.fakeClient.storedRecord(created.id)!;

    const store = await openProjectDocument(context, created.id);
    const state = store.getState();
    expect(state.origin).toEqual({ kind: 'project', projectId: created.id });
    expect(state.title).toBe('Quartet');
    expect(state.serverUpdatedAt).toBe(record.updatedAt);
    expect(state.zoom).toBe(1.5);
    expect(state.visibleTrackIds).toEqual([trackId]);
    expect(state.serverAvailable).toBe(true);
    expect(state.dirty).toBe(false);
  });

  it('autosaves as the web project does: score when changed, prefs always, version recorded', async () => {
    const context = testStoreContext();
    const created = await context.fakeClient.createProject(
      { name: 'P', score: threeTrackScore() },
      't'
    );
    const store = await openProjectDocument(context, created.id);

    store.getState().dispatchCommand(addMeasureCommand('Add measure'));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
    expect(context.fakeClient.updateBodies.at(-1)!.score).toBeDefined();
    expect(store.getState().serverUpdatedAt).toBe(
      context.fakeClient.storedRecord(created.id)!.updatedAt
    );
    expect(store.getState().dirty).toBe(false);

    // A visibility change alone leaves the score out.
    store.getState().setVisibleTracks([store.getState().score!.tracks[0]!.id]);
    await store.getState().saveNow();
    const body = context.fakeClient.updateBodies.at(-1)!;
    expect(body.score).toBeUndefined();
    expect(body.name).toBe('P');
    expect(body.uiPrefs?.visibleTrackIds).toHaveLength(1);
  });

  it('does not re-send the score it was opened with', async () => {
    // The server already holds it. Without recording that at open, the first
    // save after hiding a track would upload the whole score to store a list
    // of ids.
    const context = testStoreContext();
    const created = await context.fakeClient.createProject(
      { name: 'P', score: threeTrackScore() },
      't'
    );
    const store = await openProjectDocument(context, created.id);
    store.getState().setVisibleTracks([store.getState().score!.tracks[0]!.id]);
    await store.getState().saveNow();
    expect(context.fakeClient.updateBodies.at(-1)!.score).toBeUndefined();
  });

  it('reports the save state a generation poll reads', async () => {
    const context = testStoreContext();
    const created = await context.fakeClient.createProject(
      { name: 'P', score: twinkleScore() },
      't'
    );
    const store = await openProjectDocument(context, created.id);
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const real = context.fakeClient.updateProject.bind(context.fakeClient);
    context.fakeClient.updateProject = async (...args) => {
      await gate;
      return real(...args);
    };
    store.getState().dispatchCommand(addMeasureCommand('Add measure'));
    const saving = store.getState().saveNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().saveState).toBe('saving');
    release();
    await saving;
    expect(store.getState().saveState).toBe('saved');
  });

  it('syncs a local document to a new project without losing its history', async () => {
    const context = testStoreContext();
    const store = createDocumentStore({
      score: twinkleScore(),
      title: 'Local',
      context,
    });
    store.getState().dispatchCommand(addMeasureCommand('Add measure'));

    const projectId = await store.getState().syncToServer();

    const state = store.getState();
    expect(state.origin).toEqual({ kind: 'project', projectId });
    expect(state.dirty).toBe(false);
    expect(state.canUndo).toBe(true);
    expect(state.serverUpdatedAt).toBe(
      context.fakeClient.storedRecord(projectId)!.updatedAt
    );

    // From here on it saves to the project, and knows the server holds the score.
    store.getState().setVisibleTracks([state.score!.tracks[0]!.id]);
    await store.getState().saveNow();
    expect(context.fakeClient.updateBodies.at(-1)!.score).toBeUndefined();
  });

  it('reloads the server copy after stopping the transport, clean and with a fresh history', async () => {
    const context = testStoreContext();
    const created = await context.fakeClient.createProject(
      { name: 'P', score: twinkleScore() },
      't'
    );
    const store = await openProjectDocument(context, created.id);
    store.getState().dispatchCommand(addMeasureCommand('Add measure'));
    await store.getState().saveNow();

    // A generation job rewrote the project on the server.
    await context.fakeClient.updateProject(
      created.id,
      { score: threeTrackScore() },
      't'
    );
    const player = { stop: vi.fn() };
    const scoreWhenStopped: unknown[] = [];
    player.stop.mockImplementation(() =>
      scoreWhenStopped.push(store.getState().score)
    );
    const before = store.getState().score;

    await store.getState().reloadFromServer(player);

    expect(scoreWhenStopped).toEqual([before]);
    expect(store.getState().score!.tracks).toHaveLength(3);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().serverUpdatedAt).toBe(
      context.fakeClient.storedRecord(created.id)!.updatedAt
    );
  });

  it('refuses to open a project with no server behind the context', async () => {
    await expect(openProjectDocument({}, 'p1')).rejects.toThrow();
  });
});

describe('a document store and the transport', () => {
  it('carries the transport settings a player binding writes', () => {
    const store = createDocumentStore({ score: twinkleScore(), title: 'T' });
    expect(store.getState().state).toBe('stopped');
    expect(store.getState().metronome).toBe(false);
    expect(store.getState().synthLoad).toEqual({ status: 'idle' });

    const player = new MockMusicPlayer();
    const binding = bindPlayer(player, store);
    binding.setMetronome(true);
    player.emitTransport('playing');
    expect(store.getState().metronome).toBe(true);
    expect(store.getState().state).toBe('playing');
    binding.unbind();
  });

  it('opens in the background: the caret of the document in front stays put', () => {
    getMusicPositionSource().moveTo(1920);
    createDocumentStore({ score: twinkleScore(), title: 'Behind' });
    expect(getMusicPosition().tick).toBe(1920);
  });

  it('moves the caret to the start when opened straight into view', () => {
    getMusicPositionSource().moveTo(1920);
    createDocumentStore({
      score: twinkleScore(),
      title: 'In front',
      resetPosition: true,
    });
    expect(getMusicPosition().tick).toBe(0);
  });
});

describe('adoptOutsideScore', () => {
  it('stops the transport before the score changes, then notes the server version', () => {
    const context = testStoreContext();
    const store = createDocumentStore({
      score: twinkleScore(),
      title: 'T',
      context,
    });
    const before = store.getState().score;
    const seen: unknown[] = [];
    const player = { stop: () => seen.push(store.getState().score) };
    const incoming = threeTrackScore();

    adoptOutsideScore(store, incoming, player, {
      serverUpdatedAt: '2030-01-01T00:00:00.000Z',
    });

    expect(seen).toEqual([before]);
    expect(store.getState().score!.tracks).toHaveLength(3);
    expect(store.getState().serverUpdatedAt).toBe('2030-01-01T00:00:00.000Z');
    // An adoption, not an edit.
    expect(store.getState().dirty).toBe(false);
  });
});
