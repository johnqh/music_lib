import { describe, expect, it } from 'vitest';
import { createAppStore } from '../useAppStore.js';
import { changeMetadataCommand } from '../../domain/commands/structure-commands.js';
import { deleteEventsCommand } from '../../domain/commands/note-commands.js';
import { validateScore } from '../../domain/validation/validator.js';
import { twinkleScore } from '../../test/fixtures.js';

describe('score-slice', () => {
  describe('setScore', () => {
    it('adopts the score, recomputes validationIssues, and resets history by default', () => {
      const store = createAppStore();
      const score = twinkleScore();

      store.getState().setScore(score);

      const state = store.getState();
      expect(state.score).toBe(score);
      expect(state.validationIssues).toEqual(validateScore(score));
      expect(state.canUndo).toBe(false);
      expect(state.canRedo).toBe(false);
      expect(state.undoLabel).toBeNull();
      expect(state.redoLabel).toBeNull();
    });

    it('clears any prior undo/redo history when resetHistory is not false', () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      store.getState().dispatchCommand(changeMetadataCommand({ title: 'Renamed' }));
      expect(store.getState().canUndo).toBe(true);

      store.getState().setScore(twinkleScore());
      expect(store.getState().canUndo).toBe(false);
    });

    it('keeps existing history when resetHistory is false', () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      store.getState().dispatchCommand(changeMetadataCommand({ title: 'Renamed' }));
      expect(store.getState().canUndo).toBe(true);

      store.getState().setScore(twinkleScore(), { resetHistory: false });
      expect(store.getState().canUndo).toBe(true);
    });
  });

  describe('dispatchCommand', () => {
    it('runs the command, updates score/validationIssues, mirrors undo/redo state, and marks the project dirty', () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());

      store.getState().dispatchCommand(changeMetadataCommand({ title: 'New Title' }));

      const state = store.getState();
      expect(state.score?.metadata.title).toBe('New Title');
      expect(state.canUndo).toBe(true);
      expect(state.undoLabel).toBe('Change metadata');
      expect(state.canRedo).toBe(false);
      expect(state.dirty).toBe(true);
      expect(state.saveState).toBe('unsaved');
    });

    it('is a no-op when there is no score loaded', () => {
      const store = createAppStore();
      store.getState().dispatchCommand(changeMetadataCommand({ title: 'New Title' }));
      expect(store.getState().score).toBeNull();
    });

    it('recomputes validationIssues after a mutation that changes the score', () => {
      const store = createAppStore();
      const score = twinkleScore();
      store.getState().setScore(score);
      const firstNoteId = score.tracks[0].measures[0].voices[0].events[0].id;

      store.getState().dispatchCommand(deleteEventsCommand([firstNoteId]));

      const state = store.getState();
      expect(state.score).not.toBe(score);
      expect(state.validationIssues).toEqual(validateScore(state.score!));
    });
  });

  describe('undo/redo', () => {
    it('undo reverts the most recent command and updates the undo/redo mirrors', () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      store.getState().dispatchCommand(changeMetadataCommand({ title: 'New Title' }));

      store.getState().undo();

      const state = store.getState();
      expect(state.score?.metadata.title).toBe('Twinkle Twinkle Little Star');
      expect(state.canUndo).toBe(false);
      expect(state.canRedo).toBe(true);
      expect(state.redoLabel).toBe('Change metadata');
    });

    it('redo re-applies an undone command', () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      store.getState().dispatchCommand(changeMetadataCommand({ title: 'New Title' }));
      store.getState().undo();

      store.getState().redo();

      const state = store.getState();
      expect(state.score?.metadata.title).toBe('New Title');
      expect(state.canUndo).toBe(true);
      expect(state.canRedo).toBe(false);
    });

    it('undo/redo are no-ops when there is nothing to undo/redo', () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      const before = store.getState().score;

      store.getState().undo();
      store.getState().redo();

      expect(store.getState().score).toBe(before);
    });

    it('marks the project dirty on undo and redo', () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      store.getState().dispatchCommand(changeMetadataCommand({ title: 'New Title' }));
      store.setState((state) => {
        state.dirty = false;
        state.saveState = 'saved';
      });

      store.getState().undo();
      expect(store.getState().dirty).toBe(true);

      store.setState((state) => {
        state.dirty = false;
        state.saveState = 'saved';
      });
      store.getState().redo();
      expect(store.getState().dirty).toBe(true);
    });
  });
});
