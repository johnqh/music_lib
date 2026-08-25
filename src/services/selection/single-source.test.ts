/**
 * The store and `IMusicSelection` cannot disagree.
 *
 * Still tested HERE, because what it guards is the COMPOSED app store agreeing
 * with the shared selection — the singleton itself moved to music_editing with
 * the rest of the editing engine.
 *
 * The same guarantee `single-source.test.ts` makes for the playhead, made for
 * the selection: there is one writer, so a reader that never touches the store
 * still sees exactly what the store sees.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createAppStore, testStoreContext } from '../../index.js';
import {
  getMusicSelection,
  resetMusicSelection,
} from '@sudobility/music_editing';

beforeEach(() => resetMusicSelection());

function store() {
  return createAppStore({ context: testStoreContext() });
}

describe('the store feeds the shared selection', () => {
  it('selecting measures is visible through the interface', () => {
    const s = store();
    s.getState().selectMeasures(['m-3', 'm-4']);
    expect(getMusicSelection().measureIds).toEqual(['m-3', 'm-4']);
    expect(getMusicSelection().noteIds).toEqual([]);
  });

  it('selecting notes is visible through the interface', () => {
    const s = store();
    s.getState().setSelection({
      eventIds: ['n-1', 'n-2'],
      measureIds: [],
      trackIds: [],
    });
    expect(getMusicSelection().noteIds).toEqual(['n-1', 'n-2']);
  });

  it('toggling a note off updates it too', () => {
    // Toggle routes through `setSelection`; if it ever stops doing so, the
    // shared selection would keep a note the store had already dropped.
    const s = store();
    s.getState().setSelection({
      eventIds: ['n-1'],
      measureIds: [],
      trackIds: [],
    });
    s.getState().toggleEvent('n-1');
    expect(getMusicSelection().noteIds).toEqual([]);
  });

  it('clearing clears it', () => {
    const s = store();
    s.getState().selectMeasures(['m-1']);
    s.getState().clearSelection();
    expect(getMusicSelection().measureIds).toEqual([]);
  });

  it('the active track is reported, and is separate from selected tracks', () => {
    const s = store();
    s.getState().setActiveTrack('t-2');
    expect(getMusicSelection().activeTrackId).toBe('t-2');
    // Selecting a track is a different act from making it active; the
    // interface keeps them apart because the editor does.
    expect(getMusicSelection().trackIds).toEqual([]);
  });

  it('notifies subscribers when the selection changes', () => {
    const s = store();
    let calls = 0;
    const off = getMusicSelection().subscribe(() => (calls += 1));
    s.getState().selectMeasures(['m-1']);
    s.getState().setActiveTrack('t-1');
    off();
    s.getState().selectMeasures(['m-2']);
    expect(calls).toBe(2);
  });

  it('agrees with the store after every change', () => {
    const s = store();
    for (const ids of [['a'], ['a', 'b'], [], ['c']]) {
      s.getState().setSelection({
        eventIds: ids,
        measureIds: [],
        trackIds: [],
      });
      expect(getMusicSelection().noteIds).toEqual(
        s.getState().selection.eventIds
      );
    }
  });
});
