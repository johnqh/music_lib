import { describe, expect, it } from 'vitest';
import { testStoreContext } from '../test/store-context.js';
import { createAppStore } from './useAppStore.js';
import {
  selectActiveTrackId,
  selectCurrentMeasureBeat,
  selectSelectedMeasureRange,
  selectSelectedMeasures,
  selectSelectedNoteCount,
  selectSelectedNotes,
  selectSelectedTrack,
  selectVisibleTrackIds,
} from './selectors.js';
import type { Score } from '@sudobility/music_types';
import {
  threeTrackScore,
  twinkleScore,
  twoTrackScore,
} from '../test/fixtures.js';

describe('selectors', () => {
  describe('selectSelectedNotes / selectSelectedNoteCount', () => {
    it('returns [] / 0 with no score', () => {
      const store = createAppStore({ context: testStoreContext() });
      expect(selectSelectedNotes(store.getState())).toEqual([]);
      expect(selectSelectedNoteCount(store.getState())).toBe(0);
    });

    it('resolves selected note events, skipping stale ids and rests', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      store.getState().setScore(score);
      const notes = score.tracks[0].measures[0].voices[0].events;

      store.getState().setSelection({
        eventIds: [notes[0].id, notes[2].id, 'stale'],
        measureIds: [],
        trackIds: [],
      });

      const selected = selectSelectedNotes(store.getState());
      expect(selected.map(n => n.id).sort()).toEqual(
        [notes[0].id, notes[2].id].sort()
      );
      expect(selectSelectedNoteCount(store.getState())).toBe(2);
    });
  });

  describe('selectSelectedMeasureRange', () => {
    it('is null with no score', () => {
      const store = createAppStore({ context: testStoreContext() });
      expect(selectSelectedMeasureRange(store.getState())).toBeNull();
    });

    it('mirrors selectionToRange for the current selection', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      store.getState().setScore(score);
      const measure = score.tracks[0].measures[0];

      store.getState().selectMeasures([measure.id]);

      const range = selectSelectedMeasureRange(store.getState());
      expect(range).toEqual({
        startTick: measure.startTick,
        endTick: measure.startTick + measure.durationTicks,
        trackIds: [score.tracks[0].id],
      });
    });
  });

  describe('selectCurrentMeasureBeat', () => {
    it('is null with no score', () => {
      const store = createAppStore({ context: testStoreContext() });
      expect(selectCurrentMeasureBeat(store.getState())).toBeNull();
    });

    it('reports 1-based measure/beat at tick 0', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      expect(selectCurrentMeasureBeat(store.getState())).toEqual({
        measureIndex: 1,
        beat: 1,
      });
    });

    it('reports the correct measure/beat partway through the score (480 ppq, 4/4 => 480 ticks/beat, 1920/measure)', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store.getState().setCaretTick(1920 + 480 * 2); // measure 2, beat 3
      expect(selectCurrentMeasureBeat(store.getState())).toEqual({
        measureIndex: 2,
        beat: 3,
      });
    });

    it('clamps to the last measure when positionTick is past the end of the score', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      store.getState().setScore(score);
      store.getState().setCaretTick(1_000_000);
      const lastMeasure =
        score.tracks[0].measures[score.tracks[0].measures.length - 1];
      expect(selectCurrentMeasureBeat(store.getState())!.measureIndex).toBe(
        lastMeasure.index + 1
      );
    });
  });

  describe('memoization (finding 3)', () => {
    it('selectSelectedNotes returns the same array reference across repeated calls with unchanged inputs, and a new one once the selection changes', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      store.getState().setScore(score);
      const noteId = score.tracks[0].measures[0].voices[0].events[0].id;
      store
        .getState()
        .setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

      const first = selectSelectedNotes(store.getState());
      const second = selectSelectedNotes(store.getState());
      expect(second).toBe(first);
      expect(second).toEqual([expect.objectContaining({ id: noteId })]);

      store
        .getState()
        .setSelection({ eventIds: [], measureIds: [], trackIds: [] });
      const third = selectSelectedNotes(store.getState());
      expect(third).not.toBe(first);
    });

    it('selectSelectedMeasureRange returns the same object reference across repeated calls with unchanged inputs, and a new one once the selection changes', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = twinkleScore();
      store.getState().setScore(score);
      store.getState().selectMeasures([score.tracks[0].measures[0].id]);

      const first = selectSelectedMeasureRange(store.getState());
      const second = selectSelectedMeasureRange(store.getState());
      expect(second).toBe(first);

      store.getState().selectMeasures([score.tracks[0].measures[1].id]);
      const third = selectSelectedMeasureRange(store.getState());
      expect(third).not.toBe(first);
    });

    it('selectCurrentMeasureBeat returns the same object reference across repeated calls with unchanged inputs, and a new one once positionTick changes', () => {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(twinkleScore());
      store.getState().setCaretTick(480);

      const first = selectCurrentMeasureBeat(store.getState());
      const second = selectCurrentMeasureBeat(store.getState());
      expect(second).toBe(first);

      store.getState().setCaretTick(960);
      const third = selectCurrentMeasureBeat(store.getState());
      expect(third).not.toBe(first);
    });
  });
});

describe('selectActiveTrackId', () => {
  it('returns null when there is no score', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(selectActiveTrackId(store.getState())).toBeNull();
  });

  it('falls back to the first track when nothing is set', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = twinkleScore();
    store.getState().setScore(score);
    expect(selectActiveTrackId(store.getState())).toBe(score.tracks[0].id);
  });

  it('returns the stored id when it still resolves', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = twoTrackScore();
    store.getState().setScore(score);
    store.getState().setActiveTrack(score.tracks[1].id);
    expect(selectActiveTrackId(store.getState())).toBe(score.tracks[1].id);
  });

  it('falls back to the first track when the stored id no longer resolves', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = twinkleScore();
    store.getState().setScore(score);
    store.getState().setActiveTrack('deleted-track');
    expect(selectActiveTrackId(store.getState())).toBe(score.tracks[0].id);
  });

  it('is reference-stable across unrelated store updates', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twoTrackScore());
    const first = selectActiveTrackId(store.getState());
    store.getState().setZoom(2);
    expect(selectActiveTrackId(store.getState())).toBe(first);
  });

  describe('with hidden tracks', () => {
    it('falls back to the first visible track, not the first track', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = threeTrackScore();
      store.getState().setScore(score);
      store
        .getState()
        .setVisibleTracks([score.tracks[1].id, score.tracks[2].id]);
      expect(selectActiveTrackId(store.getState())).toBe(score.tracks[1].id);
    });

    it('falls back off an explicitly-set track that is hidden', () => {
      const store = createAppStore({ context: testStoreContext() });
      const score = threeTrackScore();
      store.getState().setScore(score);
      // Set the active track first: setActiveTrack reveals, so hiding has to
      // come second for the stale combination to exist at all.
      store.getState().setActiveTrack(score.tracks[0].id);
      store.getState().setVisibleTracks([score.tracks[1].id]);
      expect(selectActiveTrackId(store.getState())).toBe(score.tracks[1].id);
    });
  });
});

describe('selectVisibleTrackIds', () => {
  const ids = (score: Score): string[] => score.tracks.map(t => t.id);

  it('returns every track when visibleTrackIds is null', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = threeTrackScore();
    store.getState().setScore(score);
    expect(selectVisibleTrackIds(store.getState())).toEqual(ids(score));
  });

  it('returns the stored subset', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = threeTrackScore();
    store.getState().setScore(score);
    store.getState().setVisibleTracks([score.tracks[1].id]);
    expect(selectVisibleTrackIds(store.getState())).toEqual([
      score.tracks[1].id,
    ]);
  });

  it('returns them in score order, not stored order', () => {
    // The order tracks are drawn in is the score's, not the order the user
    // happened to tick the boxes.
    const store = createAppStore({ context: testStoreContext() });
    const score = threeTrackScore();
    store.getState().setScore(score);
    store.getState().setVisibleTracks([score.tracks[2].id, score.tracks[0].id]);
    expect(selectVisibleTrackIds(store.getState())).toEqual([
      score.tracks[0].id,
      score.tracks[2].id,
    ]);
  });

  it('drops ids that no longer resolve', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = threeTrackScore();
    store.getState().setScore(score);
    store.getState().setVisibleTracks([score.tracks[0].id, 'deleted-track']);
    expect(selectVisibleTrackIds(store.getState())).toEqual([
      score.tracks[0].id,
    ]);
  });

  it('falls back to every track when nothing stored resolves', () => {
    // A blank page is never the right answer, so this is the one place the
    // invariant has to hold no matter what is stored.
    const store = createAppStore({ context: testStoreContext() });
    const score = threeTrackScore();
    store.getState().setScore(score);
    store.getState().setVisibleTracks(['deleted-track']);
    expect(selectVisibleTrackIds(store.getState())).toEqual(ids(score));
  });

  it('returns [] when there is no score', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(selectVisibleTrackIds(store.getState())).toEqual([]);
  });

  it('is reference-stable across unrelated store updates', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(threeTrackScore());
    const first = selectVisibleTrackIds(store.getState());
    store.getState().setZoom(2);
    expect(selectVisibleTrackIds(store.getState())).toBe(first);
  });
});

describe('selectSelectedTrack', () => {
  it('resolves the active track to its object', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twoTrackScore());
    const second = store.getState().score!.tracks[1];
    store.getState().setActiveTrack(second.id);

    expect(selectSelectedTrack(store.getState())?.id).toBe(second.id);
  });

  it('falls back to the first track rather than emptying', () => {
    // "One track is always active" is what lets a property sheet render with
    // no reconciliation effect — including right after the active one is
    // deleted, when the stored id is stale.
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twoTrackScore());
    store.getState().setActiveTrack('no-such-track');

    expect(selectSelectedTrack(store.getState())?.id).toBe(
      store.getState().score!.tracks[0].id
    );
  });

  it('is null with no score', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(selectSelectedTrack(store.getState())).toBeNull();
  });

  it('returns the same reference until the track changes', () => {
    // Handed straight to `useAppStore(selector)`, so an unstable reference
    // would re-render the panel on every unrelated store update.
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    const first = selectSelectedTrack(store.getState());
    store.getState().setZoom(1.5);
    expect(selectSelectedTrack(store.getState())).toBe(first);
  });
});

describe('selectSelectedMeasures', () => {
  it('resolves selected measure ids, in score order', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    const measures = store.getState().score!.tracks[0].measures;
    store.getState().setSelection({
      eventIds: [],
      measureIds: [measures[1].id, measures[0].id],
      trackIds: [],
    });

    expect(selectSelectedMeasures(store.getState()).map(m => m.id)).toEqual([
      measures[0].id,
      measures[1].id,
    ]);
  });

  it('skips ids that no longer resolve', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    store
      .getState()
      .setSelection({ eventIds: [], measureIds: ['gone'], trackIds: [] });
    expect(selectSelectedMeasures(store.getState())).toEqual([]);
  });
});
