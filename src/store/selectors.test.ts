import { describe, expect, it } from 'vitest';
import { createAppStore } from './useAppStore.js';
import {
  selectCurrentMeasureBeat,
  selectSelectedMeasureRange,
  selectSelectedNoteCount,
  selectSelectedNotes,
} from './selectors.js';
import { twinkleScore } from '../test/fixtures.js';

describe('selectors', () => {
  describe('selectSelectedNotes / selectSelectedNoteCount', () => {
    it('returns [] / 0 with no score', () => {
      const store = createAppStore();
      expect(selectSelectedNotes(store.getState())).toEqual([]);
      expect(selectSelectedNoteCount(store.getState())).toBe(0);
    });

    it('resolves selected note events, skipping stale ids and rests', () => {
      const store = createAppStore();
      const score = twinkleScore();
      store.getState().setScore(score);
      const notes = score.tracks[0].measures[0].voices[0].events;

      store.getState().setSelection({
        eventIds: [notes[0].id, notes[2].id, 'stale'],
        measureIds: [],
        trackIds: [],
      });

      const selected = selectSelectedNotes(store.getState());
      expect(selected.map((n) => n.id).sort()).toEqual([notes[0].id, notes[2].id].sort());
      expect(selectSelectedNoteCount(store.getState())).toBe(2);
    });
  });

  describe('selectSelectedMeasureRange', () => {
    it('is null with no score', () => {
      const store = createAppStore();
      expect(selectSelectedMeasureRange(store.getState())).toBeNull();
    });

    it('mirrors selectionToRange for the current selection', () => {
      const store = createAppStore();
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
      const store = createAppStore();
      expect(selectCurrentMeasureBeat(store.getState())).toBeNull();
    });

    it('reports 1-based measure/beat at tick 0', () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      expect(selectCurrentMeasureBeat(store.getState())).toEqual({ measureIndex: 1, beat: 1 });
    });

    it('reports the correct measure/beat partway through the score (480 ppq, 4/4 => 480 ticks/beat, 1920/measure)', () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      store.getState().setPositionTick(1920 + 480 * 2); // measure 2, beat 3
      expect(selectCurrentMeasureBeat(store.getState())).toEqual({ measureIndex: 2, beat: 3 });
    });

    it('clamps to the last measure when positionTick is past the end of the score', () => {
      const store = createAppStore();
      const score = twinkleScore();
      store.getState().setScore(score);
      store.getState().setPositionTick(1_000_000);
      const lastMeasure = score.tracks[0].measures[score.tracks[0].measures.length - 1];
      expect(selectCurrentMeasureBeat(store.getState())!.measureIndex).toBe(lastMeasure.index + 1);
    });
  });

  describe('memoization (finding 3)', () => {
    it('selectSelectedNotes returns the same array reference across repeated calls with unchanged inputs, and a new one once the selection changes', () => {
      const store = createAppStore();
      const score = twinkleScore();
      store.getState().setScore(score);
      const noteId = score.tracks[0].measures[0].voices[0].events[0].id;
      store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

      const first = selectSelectedNotes(store.getState());
      const second = selectSelectedNotes(store.getState());
      expect(second).toBe(first);
      expect(second).toEqual([expect.objectContaining({ id: noteId })]);

      store.getState().setSelection({ eventIds: [], measureIds: [], trackIds: [] });
      const third = selectSelectedNotes(store.getState());
      expect(third).not.toBe(first);
    });

    it('selectSelectedMeasureRange returns the same object reference across repeated calls with unchanged inputs, and a new one once the selection changes', () => {
      const store = createAppStore();
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
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      store.getState().setPositionTick(480);

      const first = selectCurrentMeasureBeat(store.getState());
      const second = selectCurrentMeasureBeat(store.getState());
      expect(second).toBe(first);

      store.getState().setPositionTick(960);
      const third = selectCurrentMeasureBeat(store.getState());
      expect(third).not.toBe(first);
    });
  });
});
