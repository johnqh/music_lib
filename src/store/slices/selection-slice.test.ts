import { describe, expect, it } from 'vitest';
import { testStoreContext } from '../../test/store-context.js';
import { createAppStore } from '../useAppStore.js';
import { emptySelection } from '@sudobility/music_types';
import { twinkleScore, twoTrackScore } from '../../test/fixtures.js';
import { allNotes } from '@sudobility/music_types';

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

      store
        .getState()
        .setSelection({ eventIds: ['a'], measureIds: [], trackIds: [] });
      expect(store.getState().mode).toBe('regenerate');

      store.getState().clearSelection();
      expect(store.getState().mode).toBe('generate');
    });

    it('a bare track-only selection stays in "generate" mode (no tick content selected)', () => {
      const store = createAppStore({ context: testStoreContext() });
      store
        .getState()
        .setSelection({ eventIds: [], measureIds: [], trackIds: ['track-1'] });
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
      store.getState().setSelection({
        eventIds: ['stale'],
        measureIds: [],
        trackIds: ['stale-track'],
      });

      store.getState().selectMeasures(['m1', 'm2']);

      expect(store.getState().selection).toEqual({
        eventIds: [],
        measureIds: ['m1', 'm2'],
        trackIds: [],
      });
    });

    it('selectTrack replaces the selection with only that track id', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setSelection({
        eventIds: ['stale'],
        measureIds: ['stale-measure'],
        trackIds: [],
      });

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
      expect(clipboard!.events.map(e => e.id).sort()).toEqual(
        [notes[0].id, notes[1].id].sort()
      );
      expect(clipboard!.anchorTick).toBe(
        Math.min(notes[0].startTick, notes[1].startTick)
      );
    });

    it('copySelection is a no-op when nothing selected resolves to a note', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store.getState().setSelection({
        eventIds: ['nonexistent'],
        measureIds: [],
        trackIds: [],
      });

      store.getState().copySelection();

      expect(store.getState().clipboard).toBeNull();
    });

    it('cutSelection copies then deletes the selected notes as one undoable command, and clears the selection', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      store.getState().setScore(score);
      const noteId = score.tracks[0].measures[0].voices[0].events[0].id;
      store
        .getState()
        .setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

      store.getState().cutSelection();

      const state = store.getState();
      expect(state.clipboard?.events[0]?.id).toBe(noteId);
      expect(state.selection).toEqual(emptySelection());
      expect(state.canUndo).toBe(true);
      // The note is gone from the (mutated) score.
      const stillThere =
        state.score!.tracks[0].measures[0].voices[0].events.some(
          e => e.id === noteId
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

      store
        .getState()
        .setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
      store.getState().copySelection();
      store
        .getState()
        .setSelection({ eventIds: [], measureIds: [], trackIds: [bassId] });

      store.getState().paste(0);

      const state = store.getState();
      expect(state.canUndo).toBe(true);
      const bassTrack = state.score!.tracks.find(t => t.id === bassId)!;
      const trebleTrack = state.score!.tracks.find(t => t.id === trebleId)!;
      // Pasted note landed on the bass track...
      expect(
        bassTrack.measures[0].voices[0].events.some(
          e => 'pitch' in e && e.startTick === 0
        )
      ).toBe(true);
      // ...and the treble track (source of the copy) is otherwise unaffected in note count terms.
      expect(trebleTrack.measures[0].voices[0].events.length).toBeGreaterThan(
        0
      );
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
    store
      .getState()
      .setSelection({ eventIds: [], measureIds: [], trackIds: [] });
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

  describe('paste honours the edit mode', () => {
    /** Copies the first treble note, then targets the treble track itself. */
    function storeWithClipboard() {
      const store = createAppStore({ context: testStoreContext() });
      const score = twoTrackScore();
      store.getState().setScore(score);
      const trackId = score.tracks[0].id;
      const noteId = score.tracks[0].measures[0].voices[0].events[0].id;
      store
        .getState()
        .setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
      store.getState().copySelection();
      store
        .getState()
        .setSelection({ eventIds: [], measureIds: [], trackIds: [trackId] });
      return { store, trackId };
    }

    const notesOn = (
      store: ReturnType<typeof createAppStore>,
      trackId: string
    ) =>
      allNotes(store.getState().score!)
        .filter(n => n.trackId === trackId)
        .sort((a, b) => a.startTick - b.startTick);

    it('insert mode keeps everything that was there', () => {
      const { store, trackId } = storeWithClipboard();
      store.getState().setEditMode('insert');
      const before = notesOn(store, trackId).map(n => n.id);

      store.getState().paste(0);

      const afterIds = new Set(notesOn(store, trackId).map(n => n.id));
      for (const id of before)
        expect(afterIds.has(id), `note ${id} survived`).toBe(true);
    });

    it('replace mode clears the span it pastes into', () => {
      const { store, trackId } = storeWithClipboard();
      store.getState().setEditMode('replace');
      const displaced = notesOn(store, trackId)[0].id;

      store.getState().paste(0);

      expect(notesOn(store, trackId).some(n => n.id === displaced)).toBe(false);
    });

    it('stack mode leaves the existing notes in place', () => {
      const { store, trackId } = storeWithClipboard();
      store.getState().setEditMode('stack');
      const before = notesOn(store, trackId).length;

      store.getState().paste(0);

      expect(notesOn(store, trackId).length).toBeGreaterThanOrEqual(before);
    });
  });
});

describe('cut can close the gap it leaves', () => {
  function storeWithMelody() {
    const store = createAppStore({ context: testStoreContext() });
    const score = twoTrackScore();
    store.getState().setScore(score);
    return { store, trackId: score.tracks[0].id };
  }

  const notesOn = (store: ReturnType<typeof createAppStore>, trackId: string) =>
    allNotes(store.getState().score!)
      .filter(n => n.trackId === trackId)
      .sort((a, b) => a.startTick - b.startTick);

  it('leaves silence by default', () => {
    const { store, trackId } = storeWithMelody();
    const notes = notesOn(store, trackId);
    const second = notes[1];
    const thirdStart = notes[2].startTick;
    store
      .getState()
      .setSelection({ eventIds: [second.id], measureIds: [], trackIds: [] });

    store.getState().cutSelection();

    // The note after the cut has not moved: the time it left is now rest.
    expect(
      notesOn(store, trackId).find(n => n.id === notes[2].id)!.startTick
    ).toBe(thirdStart);
  });

  it('slides the rest of the track up when asked', () => {
    const { store, trackId } = storeWithMelody();
    const notes = notesOn(store, trackId);
    const second = notes[1];
    const gap = second.durationTicks;
    const thirdStart = notes[2].startTick;
    store
      .getState()
      .setSelection({ eventIds: [second.id], measureIds: [], trackIds: [] });

    store.getState().cutSelection({ closeGap: true });

    expect(
      notesOn(store, trackId).find(n => n.id === notes[2].id)!.startTick
    ).toBe(thirdStart - gap);
  });

  it('leaves the other track alone when closing a gap', () => {
    const { store, trackId } = storeWithMelody();
    const otherId = store.getState().score!.tracks[1].id;
    const before = notesOn(store, otherId).map(n => n.startTick);
    const second = notesOn(store, trackId)[1];
    store
      .getState()
      .setSelection({ eventIds: [second.id], measureIds: [], trackIds: [] });

    store.getState().cutSelection({ closeGap: true });

    expect(notesOn(store, otherId).map(n => n.startTick)).toEqual(before);
  });

  it('still puts the cut notes on the clipboard', () => {
    const { store, trackId } = storeWithMelody();
    const second = notesOn(store, trackId)[1];
    store
      .getState()
      .setSelection({ eventIds: [second.id], measureIds: [], trackIds: [] });

    store.getState().cutSelection({ closeGap: true });

    expect(store.getState().clipboard?.events.length).toBe(1);
  });
});

describe('paste takes an explicit scope', () => {
  it('an explicit scope overrides the edit mode', () => {
    // The dialog asks the user; their answer must win over whatever mode the
    // toolbar happens to be in.
    const store = createAppStore({ context: testStoreContext() });
    const score = twoTrackScore();
    store.getState().setScore(score);
    const trackId = score.tracks[0].id;
    const noteId = score.tracks[0].measures[0].voices[0].events[0].id;
    store
      .getState()
      .setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
    store.getState().copySelection();
    store
      .getState()
      .setSelection({ eventIds: [], measureIds: [], trackIds: [trackId] });
    store.getState().setEditMode('replace');

    const before = allNotes(store.getState().score!).filter(
      n => n.trackId === trackId
    ).length;
    store.getState().paste(0, { scope: 'insert' });

    // Insert keeps everything; replace would have cleared the span.
    expect(
      allNotes(store.getState().score!).filter(n => n.trackId === trackId)
        .length
    ).toBeGreaterThan(before);
  });
});

describe('selectRegenerated', () => {
  it('marks the selection as generated material, so the editor can colour it', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = twinkleScore();
    store.getState().setScore(score);
    const [first, second] = allNotes(score);

    store.getState().selectRegenerated([first.id, second.id]);

    expect(store.getState().selection.eventIds).toEqual([first.id, second.id]);
    expect(store.getState().selectionRegenerated).toBe(true);
  });

  it('clears the mark on the next ordinary selection change', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = twinkleScore();
    store.getState().setScore(score);
    const [first] = allNotes(score);

    store.getState().selectRegenerated([first.id]);
    store
      .getState()
      .setSelection({ eventIds: [first.id], measureIds: [], trackIds: [] });

    expect(store.getState().selectionRegenerated).toBe(false);
  });

  it('marks nothing when a generation produced no notes', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().selectRegenerated([]);
    expect(store.getState().selectionRegenerated).toBe(false);
  });
});
