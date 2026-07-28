import { describe, expect, it } from 'vitest';
import { testStoreContext } from '../../test/store-context.js';
import { createAppStore } from '../useAppStore.js';
import { emptySelection } from '../../domain/selection/types.js';
import { twinkleScore, twoTrackScore } from '../../test/fixtures.js';

describe('selection-slice', () => {
  describe('setSelection / clearSelection', () => {
    it('replaces the selection outright and clears back to empty', () => {
      const store = createAppStore({ context: testStoreContext() });
      const selection = { eventIds: ['a'], measureIds: [], trackIds: [] };

      store.getState().setSelection(selection);
      expect(store.getState().selection).toEqual(selection);

      store.getState().clearSelection();
      expect(store.getState().selection).toEqual(emptySelection());
    });

    it('derives generation mode "regenerate" from a non-empty selection, "generate" from empty', () => {
      const store = createAppStore({ context: testStoreContext() });
      expect(store.getState().mode).toBe('generate');

      store.getState().setSelection({ eventIds: ['a'], measureIds: [], trackIds: [] });
      expect(store.getState().mode).toBe('regenerate');

      store.getState().clearSelection();
      expect(store.getState().mode).toBe('generate');
    });

    it('a bare track-only selection stays in "generate" mode (no tick content selected)', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setSelection({ eventIds: [], measureIds: [], trackIds: ['track-1'] });
      expect(store.getState().mode).toBe('generate');
    });
  });

  describe('toggleEvent', () => {
    it('adds an id not yet selected, and removes one already selected', () => {
      const store = createAppStore({ context: testStoreContext() });

      store.getState().toggleEvent('note-1');
      expect(store.getState().selection.eventIds).toEqual(['note-1']);

      store.getState().toggleEvent('note-2');
      expect(store.getState().selection.eventIds).toEqual(['note-1', 'note-2']);

      store.getState().toggleEvent('note-1');
      expect(store.getState().selection.eventIds).toEqual(['note-2']);
    });
  });

  describe('selectMeasures / selectTrack', () => {
    it('selectMeasures replaces the selection with only those measure ids', () => {
      const store = createAppStore({ context: testStoreContext() });
      store
        .getState()
        .setSelection({ eventIds: ['stale'], measureIds: [], trackIds: ['stale-track'] });

      store.getState().selectMeasures(['m1', 'm2']);

      expect(store.getState().selection).toEqual({
        eventIds: [],
        measureIds: ['m1', 'm2'],
        trackIds: [],
      });
    });

    it('selectTrack replaces the selection with only that track id', () => {
      const store = createAppStore({ context: testStoreContext() });
      store
        .getState()
        .setSelection({ eventIds: ['stale'], measureIds: ['stale-measure'], trackIds: [] });

      store.getState().selectTrack('track-1');

      expect(store.getState().selection).toEqual({
        eventIds: [],
        measureIds: [],
        trackIds: ['track-1'],
      });
    });
  });

  describe('copySelection / cutSelection / paste', () => {
    it('copySelection copies selected note events (skipping stale/unresolvable ids) to the clipboard', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      store.getState().setScore(score);
      const notes = score.tracks[0].measures[0].voices[0].events;

      store.getState().setSelection({
        eventIds: [notes[0].id, notes[1].id, 'stale-id'],
        measureIds: [],
        trackIds: [],
      });
      store.getState().copySelection();

      const clipboard = store.getState().clipboard;
      expect(clipboard).not.toBeNull();
      expect(clipboard!.events.map((e) => e.id).sort()).toEqual([notes[0].id, notes[1].id].sort());
      expect(clipboard!.anchorTick).toBe(Math.min(notes[0].startTick, notes[1].startTick));
    });

    it('copySelection is a no-op when nothing selected resolves to a note', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store.getState().setSelection({ eventIds: ['nonexistent'], measureIds: [], trackIds: [] });

      store.getState().copySelection();

      expect(store.getState().clipboard).toBeNull();
    });

    it('cutSelection copies then deletes the selected notes as one undoable command, and clears the selection', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      store.getState().setScore(score);
      const noteId = score.tracks[0].measures[0].voices[0].events[0].id;
      store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

      store.getState().cutSelection();

      const state = store.getState();
      expect(state.clipboard?.events[0]?.id).toBe(noteId);
      expect(state.selection).toEqual(emptySelection());
      expect(state.canUndo).toBe(true);
      // The note is gone from the (mutated) score.
      const stillThere = state.score!.tracks[0].measures[0].voices[0].events.some(
        (e) => e.id === noteId,
      );
      expect(stillThere).toBe(false);
    });

    it('cutSelection is a no-op when nothing selected resolves to a note', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store.getState().cutSelection();
      expect(store.getState().canUndo).toBe(false);
    });

    it('paste inserts the clipboard notes onto the currently-selected track at the given anchor tick', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twoTrackScore();
      store.getState().setScore(score);
      const trebleId = score.tracks[0].id;
      const bassId = score.tracks[1].id;
      const noteId = score.tracks[0].measures[0].voices[0].events[0].id;

      store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
      store.getState().copySelection();
      store.getState().setSelection({ eventIds: [], measureIds: [], trackIds: [bassId] });

      store.getState().paste(0);

      const state = store.getState();
      expect(state.canUndo).toBe(true);
      const bassTrack = state.score!.tracks.find((t) => t.id === bassId)!;
      const trebleTrack = state.score!.tracks.find((t) => t.id === trebleId)!;
      // Pasted note landed on the bass track...
      expect(
        bassTrack.measures[0].voices[0].events.some((e) => 'pitch' in e && e.startTick === 0),
      ).toBe(true);
      // ...and the treble track (source of the copy) is otherwise unaffected in note count terms.
      expect(trebleTrack.measures[0].voices[0].events.length).toBeGreaterThan(0);
    });

    it('paste is a no-op when the clipboard is empty', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store.getState().paste();
      expect(store.getState().canUndo).toBe(false);
    });
  });
});

describe('selectionRegenerated', () => {
  it('defaults to false', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(store.getState().selectionRegenerated).toBe(false);
  });

  it('is cleared by setSelection', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.setState({ selectionRegenerated: true });
    store.getState().setSelection({ eventIds: [], measureIds: [], trackIds: [] });
    expect(store.getState().selectionRegenerated).toBe(false);
  });

  it('is cleared by clearSelection, which funnels through setSelection', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.setState({ selectionRegenerated: true });
    store.getState().clearSelection();
    expect(store.getState().selectionRegenerated).toBe(false);
  });

  it('is cleared by selectMeasures and selectTrack too', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.setState({ selectionRegenerated: true });
    store.getState().selectMeasures(['m1']);
    expect(store.getState().selectionRegenerated).toBe(false);

    store.setState({ selectionRegenerated: true });
    store.getState().selectTrack('t1');
    expect(store.getState().selectionRegenerated).toBe(false);
  });
});
