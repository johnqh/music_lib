import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import { HistoryManager } from './history.js';
import type { ScoreCommand } from './types.js';
import { changeMetadataCommand } from './structure-commands.js';

/** A trivial command for bookkeeping-only tests (limit eviction, redo-clearing), independent of score content. */
function noopCommand(label: string): ScoreCommand {
  return { id: label, label, timestamp: 0, execute: (s) => s, undo: (s) => s };
}

describe('HistoryManager (real commands)', () => {
  it('execute applies the command; undo/redo round-trip through the actual score', () => {
    const history = new HistoryManager();
    const score = createEmptyScore({ title: 'Original' });
    const cmd = changeMetadataCommand({ title: 'Renamed' });

    const afterExecute = history.execute(cmd, score);
    expect(afterExecute.metadata.title).toBe('Renamed');

    const afterUndo = history.undo(afterExecute);
    expect(afterUndo).toEqual(score);

    // changeMetadataCommand refreshes updatedAt on every real execute, so
    // redo (a fresh execute call) legitimately produces a new timestamp;
    // everything else should match the original execute's result.
    const afterRedo = history.redo(afterUndo as typeof score);
    expect(afterRedo).toEqual({ ...afterExecute, metadata: { ...afterExecute.metadata, updatedAt: afterRedo?.metadata.updatedAt } });
  });
});

describe('HistoryManager (bookkeeping)', () => {
  it('canUndo/canRedo/labels reflect stack state', () => {
    const history = new HistoryManager();
    const score = createEmptyScore({ title: 'S' });

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoLabel).toBeNull();
    expect(history.redoLabel).toBeNull();

    const s1 = history.execute(noopCommand('First'), score);
    expect(history.canUndo).toBe(true);
    expect(history.undoLabel).toBe('First');
    expect(history.canRedo).toBe(false);

    const s0 = history.undo(s1);
    expect(s0).toBe(score);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.redoLabel).toBe('First');
  });

  it('undo/redo on an empty stack return null', () => {
    const history = new HistoryManager();
    const score = createEmptyScore({ title: 'S' });
    expect(history.undo(score)).toBeNull();
    expect(history.redo(score)).toBeNull();
  });

  it('executing a new command clears the redo stack', () => {
    const history = new HistoryManager();
    const score = createEmptyScore({ title: 'S' });

    const s1 = history.execute(noopCommand('A'), score);
    history.undo(s1);
    expect(history.canRedo).toBe(true);

    history.execute(noopCommand('B'), score);
    expect(history.canRedo).toBe(false);
    expect(history.redo(score)).toBeNull();
  });

  it('evicts the oldest undo entry once the configured limit is exceeded', () => {
    const history = new HistoryManager(3);
    const score = createEmptyScore({ title: 'S' });

    let current = score;
    for (const label of ['A', 'B', 'C', 'D', 'E']) {
      current = history.execute(noopCommand(label), current);
    }

    // Only the 3 most recent commands (C, D, E) survive; undoing 3 times
    // empties the stack, and undoLabel confirms eviction order.
    expect(history.undoLabel).toBe('E');
    history.undo(current);
    expect(history.undoLabel).toBe('D');
    history.undo(current);
    expect(history.undoLabel).toBe('C');
    history.undo(current);
    expect(history.canUndo).toBe(false);
  });

  it('defaults to a limit of 200 (no eviction for a handful of commands)', () => {
    const history = new HistoryManager();
    const score = createEmptyScore({ title: 'S' });
    let current = score;
    for (let i = 0; i < 10; i += 1) {
      current = history.execute(noopCommand(`cmd-${i}`), current);
    }
    for (let i = 0; i < 10; i += 1) {
      expect(history.canUndo).toBe(true);
      current = history.undo(current) as typeof score;
    }
    expect(history.canUndo).toBe(false);
  });

  it('clear() empties both stacks', () => {
    const history = new HistoryManager();
    const score = createEmptyScore({ title: 'S' });
    const s1 = history.execute(noopCommand('A'), score);
    history.undo(s1);
    expect(history.canRedo).toBe(true);

    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoLabel).toBeNull();
    expect(history.redoLabel).toBeNull();
  });
});
