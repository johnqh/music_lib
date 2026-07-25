import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppStore } from './useAppStore';
import { ScoreSmithDb } from '../services/persistence/db';
import { resetProvider } from '../services/generation/registry';
import { changeMetadataCommand } from '../domain/commands/structure-commands';
import { twinkleScore } from '../test/fixtures';
import type { GenerateScoreRequest } from '@sudobility/music_types';

let db: ScoreSmithDb;
let dbCounter = 0;

afterEach(async () => {
  resetProvider();
  await db?.delete();
});

const REQUEST: GenerateScoreRequest = {
  prompt: 'Create a gentle eight-measure piano piece in A minor',
  durationMeasures: 8,
  tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
};

describe('useAppStore (integration)', () => {
  it('walks the spec §39 happy path across every slice: new project -> generate -> select+regenerate -> accept -> manual edit -> undo/redo -> save', async () => {
    dbCounter += 1;
    db = new ScoreSmithDb(`scoresmith-test-app-store-${dbCounter}`);
    const store = createAppStore({ db });

    // 1-2. Create a new project.
    await store.getState().newProject({ name: 'A Minor Piece' });
    expect(store.getState().projectId).not.toBeNull();

    // 3-5. Generate a score from a prompt.
    await store.getState().generate(REQUEST);
    expect(store.getState().score?.tracks).toHaveLength(1);
    expect(store.getState().dirty).toBe(true);

    // 8-9. Select measures 3-4-equivalent (first measure here) and regenerate.
    const measureId = store.getState().score!.tracks[0].measures[0].id;
    store.getState().selectMeasures([measureId]);
    expect(store.getState().mode).toBe('regenerate');
    await store
      .getState()
      .regenerate('Make this section more dramatic while preserving the melody');
    expect(store.getState().candidates.length).toBeGreaterThan(0);
    const scoreBeforeAccept = store.getState().score;

    // 10-13. Accept one candidate; only the region changes, as one undoable command.
    store.getState().acceptCandidate();
    expect(store.getState().score).not.toBe(scoreBeforeAccept);
    expect(store.getState().candidates).toEqual([]);
    expect(store.getState().canUndo).toBe(true);

    // 14-15. Manual edit, then undo/redo.
    const noteId = store
      .getState()
      .score!.tracks[0].measures[1].voices[0].events.find((e) => 'pitch' in e)?.id;
    expect(noteId).toBeDefined();
    const { changeVelocityCommand } = await import('../domain/commands/note-commands');
    store.getState().dispatchCommand(changeVelocityCommand([noteId!], 100));
    const findNote = () =>
      store
        .getState()
        .score!.tracks[0].measures[1].voices[0].events.find((e) => e.id === noteId) as {
        velocity: number;
      };
    expect(findNote().velocity).toBe(100);

    store.getState().undo();
    expect(findNote().velocity).not.toBe(100);

    store.getState().redo();
    expect(findNote().velocity).toBe(100);

    // 16. Switch to piano roll (ui-slice) — a purely orthogonal concern.
    store.getState().setView('piano-roll');
    expect(store.getState().view).toBe('piano-roll');

    // Save.
    await store.getState().saveNow();
    expect(store.getState().saveState).toBe('saved');
    expect(store.getState().dirty).toBe(false);

    // 25. No uncaught errors: generation-slice's error stayed clear throughout.
    expect(store.getState().error).toBeNull();
  });

  it('createAppStore() defaults to a real ScoreSmithDb without throwing at construction time', () => {
    expect(() => createAppStore()).not.toThrow();
  });

  it('gives every store its own HistoryManager (no cross-store undo bleed)', async () => {
    const dbA = new ScoreSmithDb('scoresmith-test-history-isolation-a');
    const dbB = new ScoreSmithDb('scoresmith-test-history-isolation-b');
    try {
      const storeA = createAppStore({ db: dbA });
      const storeB = createAppStore({ db: dbB });
      storeA.getState().setScore(twinkleScore());
      storeB.getState().setScore(twinkleScore());

      storeA.getState().dispatchCommand(changeMetadataCommand({ title: 'Store A only' }));

      expect(storeA.getState().canUndo).toBe(true);
      expect(storeB.getState().canUndo).toBe(false);
      expect(storeB.getState().score?.metadata.title).toBe('Twinkle Twinkle Little Star');
    } finally {
      await dbA.delete();
      await dbB.delete();
    }
  });
});
