import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import { snapshotCommand, transformCommand } from './snapshot.js';

describe('snapshotCommand', () => {
  it('applies the mutation on execute and produces a deep-equal score on undo', () => {
    const score = createEmptyScore({ title: 'Original' });
    const cmd = snapshotCommand('Rename', draft => {
      draft.metadata.title = 'Renamed';
    });

    const next = cmd.execute(score);
    expect(next.metadata.title).toBe('Renamed');
    expect(next).not.toBe(score);

    const restored = cmd.undo(next);
    expect(restored).toEqual(score);
  });

  it('exposes id, label, and a numeric timestamp', () => {
    const cmd = snapshotCommand('Label', () => {});
    expect(typeof cmd.id).toBe('string');
    expect(cmd.id.length).toBeGreaterThan(0);
    expect(cmd.label).toBe('Label');
    expect(typeof cmd.timestamp).toBe('number');
  });

  it('undo before any execute call is a safe no-op', () => {
    const score = createEmptyScore({ title: 'S' });
    const cmd = snapshotCommand('Noop', () => {});
    expect(cmd.undo(score)).toBe(score);
  });

  it('handles structural mutation (reassigning a subtree) with a correct deep-equal round trip', () => {
    const score = createEmptyScore({
      title: 'S',
      measures: 2,
      tracks: [{ name: 'Piano' }],
    });
    const cmd = snapshotCommand('Drop last measure', draft => {
      draft.tracks[0].measures = draft.tracks[0].measures.slice(0, 1);
    });

    const next = cmd.execute(score);
    expect(next.tracks[0].measures).toHaveLength(1);

    const restored = cmd.undo(next);
    expect(restored).toEqual(score);
  });

  it('recomputes patches on each execute call, so undo after redo still round-trips', () => {
    const score = createEmptyScore({ title: 'Original' });
    const cmd = snapshotCommand('Rename', draft => {
      draft.metadata.title = 'Renamed';
    });

    const afterFirstExecute = cmd.execute(score);
    const afterUndo = cmd.undo(afterFirstExecute);
    expect(afterUndo).toEqual(score);

    const afterRedo = cmd.execute(afterUndo);
    expect(afterRedo).toEqual(afterFirstExecute);

    const afterSecondUndo = cmd.undo(afterRedo);
    expect(afterSecondUndo).toEqual(score);
  });
});

describe('transformCommand', () => {
  it('adopts the pure transform result wholesale and round-trips through undo', () => {
    const score = createEmptyScore({
      title: 'Original',
      measures: 1,
      tracks: [{ name: 'Piano' }],
    });
    const cmd = transformCommand('Retitle', s => ({
      ...s,
      metadata: { ...s.metadata, title: 'New title' },
    }));

    const next = cmd.execute(score);
    expect(next.metadata.title).toBe('New title');
    expect(cmd.undo(next)).toEqual(score);
  });
});
