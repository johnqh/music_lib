import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import {
  normalizeSelection,
  selectionIsRegenerable,
  selectionSummaryLabel,
  selectionToRange,
} from './selection.js';
import { emptySelection } from './types.js';
import type { ScoreSelection } from './types.js';

function fixtureScore() {
  // 3 measures, 2 tracks (4/4, 480 ppq -> 1920 ticks/measure).
  return createEmptyScore({
    title: 'S',
    measures: 3,
    tracks: [{ name: 'A' }, { name: 'B' }],
  });
}

describe('selectionToRange', () => {
  it('returns null for an empty selection', () => {
    const score = fixtureScore();
    expect(selectionToRange(score, emptySelection())).toBeNull();
  });

  it('returns null when only trackIds are selected (no tick extent)', () => {
    const score = fixtureScore();
    const sel: ScoreSelection = {
      eventIds: [],
      measureIds: [],
      trackIds: [score.tracks[0].id],
    };
    expect(selectionToRange(score, sel)).toBeNull();
  });

  it('expands a single selected event to its containing full measure', () => {
    const score = fixtureScore();
    const track = score.tracks[0];
    const event = track.measures[1].voices[0].events[0]; // whole-measure rest in measure 1
    const sel: ScoreSelection = {
      eventIds: [event.id],
      measureIds: [],
      trackIds: [],
    };

    const range = selectionToRange(score, sel);
    expect(range).toEqual({
      startTick: track.measures[1].startTick,
      endTick: track.measures[1].startTick + track.measures[1].durationTicks,
      trackIds: [track.id],
    });
  });

  it('expands a selected measure to its own full span and records its track', () => {
    const score = fixtureScore();
    const track = score.tracks[1];
    const measure = track.measures[0];
    const sel: ScoreSelection = {
      eventIds: [],
      measureIds: [measure.id],
      trackIds: [],
    };

    const range = selectionToRange(score, sel);
    expect(range).toEqual({
      startTick: measure.startTick,
      endTick: measure.startTick + measure.durationTicks,
      trackIds: [track.id],
    });
  });

  it('covers multiple selected measures spanning a gap with the full aligned range', () => {
    const score = fixtureScore();
    const track = score.tracks[0];
    const sel: ScoreSelection = {
      eventIds: [],
      measureIds: [track.measures[0].id, track.measures[2].id],
      trackIds: [],
    };

    const range = selectionToRange(score, sel);
    expect(range).toEqual({
      startTick: 0,
      endTick: track.measures[2].startTick + track.measures[2].durationTicks,
      trackIds: [track.id],
    });
  });

  it('uses an explicit range as-is when it already sits on measure boundaries', () => {
    const score = fixtureScore();
    const track = score.tracks[0];
    const measureTicks = track.measures[0].durationTicks;
    const sel: ScoreSelection = {
      eventIds: [],
      measureIds: [],
      trackIds: [],
      range: { startTick: 0, endTick: measureTicks, trackIds: [track.id] },
    };

    expect(selectionToRange(score, sel)).toEqual({
      startTick: 0,
      endTick: measureTicks,
      trackIds: [track.id],
    });
  });

  it('expands a partial-measure range out to the full measures it overlaps', () => {
    const score = fixtureScore();
    const track = score.tracks[0];
    const measureTicks = track.measures[0].durationTicks;
    const sel: ScoreSelection = {
      eventIds: [],
      measureIds: [],
      trackIds: [],
      range: {
        startTick: measureTicks + 10,
        endTick: measureTicks + 20,
        trackIds: [track.id],
      },
    };

    expect(selectionToRange(score, sel)).toEqual({
      startTick: measureTicks,
      endTick: measureTicks * 2,
      trackIds: [track.id],
    });
  });

  it('scopes measure alignment to only the selected tracks, using [] to mean all tracks', () => {
    const score = fixtureScore();
    const sel: ScoreSelection = {
      eventIds: [],
      measureIds: [],
      trackIds: [],
      range: { startTick: 0, endTick: 10, trackIds: [] },
    };

    const range = selectionToRange(score, sel);
    expect(range?.startTick).toBe(0);
    expect(range?.endTick).toBe(score.tracks[0].measures[0].durationTicks);
    expect(range?.trackIds).toEqual([]);
  });

  it('skips stale (nonexistent) event/measure ids when gathering tick anchors', () => {
    const score = fixtureScore();
    const sel: ScoreSelection = {
      eventIds: ['missing-event'],
      measureIds: ['missing-measure'],
      trackIds: [],
    };
    expect(selectionToRange(score, sel)).toBeNull();
  });
});

describe('normalizeSelection', () => {
  it('deduplicates ids and drops stale references', () => {
    const score = fixtureScore();
    const event = score.tracks[0].measures[0].voices[0].events[0];
    const sel: ScoreSelection = {
      eventIds: [event.id, event.id, 'missing'],
      measureIds: ['missing-measure'],
      trackIds: [score.tracks[0].id, score.tracks[0].id],
    };

    expect(normalizeSelection(score, sel)).toEqual({
      eventIds: [event.id],
      measureIds: [],
      trackIds: [score.tracks[0].id],
    });
  });

  it('swaps a reversed range into ascending order and dedupes its trackIds', () => {
    const score = fixtureScore();
    const sel: ScoreSelection = {
      eventIds: [],
      measureIds: [],
      trackIds: [],
      range: { startTick: 100, endTick: 10, trackIds: ['t1', 't1'] },
    };

    expect(normalizeSelection(score, sel).range).toEqual({
      startTick: 10,
      endTick: 100,
      trackIds: ['t1'],
    });
  });
});

describe('selectionIsRegenerable', () => {
  it('is false for an empty selection', () => {
    const score = fixtureScore();
    expect(selectionIsRegenerable(score, emptySelection())).toBe(false);
  });

  it('is true for a selection that resolves to a valid in-bounds full-measure range', () => {
    const score = fixtureScore();
    const track = score.tracks[0];
    const sel: ScoreSelection = {
      eventIds: [],
      measureIds: [track.measures[0].id],
      trackIds: [],
    };
    expect(selectionIsRegenerable(score, sel)).toBe(true);
  });

  it('is false when the range extends past the end of the score', () => {
    const score = fixtureScore();
    const track = score.tracks[0];
    const endTick =
      score.tracks[0].measures[track.measures.length - 1].startTick +
      track.measures[0].durationTicks;
    const sel: ScoreSelection = {
      eventIds: [],
      measureIds: [],
      trackIds: [],
      range: { startTick: 0, endTick: endTick + 100_000, trackIds: [track.id] },
    };
    expect(selectionIsRegenerable(score, sel)).toBe(false);
  });

  it('is false when a named track does not exist in the score', () => {
    const score = fixtureScore();
    const sel: ScoreSelection = {
      eventIds: [],
      measureIds: [],
      trackIds: [],
      range: { startTick: 0, endTick: 100, trackIds: ['no-such-track'] },
    };
    expect(selectionIsRegenerable(score, sel)).toBe(false);
  });
});

/**
 * The words this suite reads back.
 *
 * `selectionSummaryLabel` no longer owns any, so the test plays the consumer;
 * the wording matches what the function used to build, which keeps these
 * assertions about *selection logic* rather than about English.
 */
const SUMMARY_COPY = {
  notes: (n: number) => `${n} note(s) selected`,
  measures: (n: number) => `${n} measure(s) selected`,
  tracks: (n: number) => `${n} track(s) selected`,
  none: 'No selection',
  regenerated: (summary: string) => `${summary}, regenerated`,
};

describe('selectionSummaryLabel regenerated variant', () => {
  const sel = { eventIds: ['a', 'b'], measureIds: [], trackIds: [] };

  it('marks a regenerated note selection', () => {
    expect(selectionSummaryLabel(sel, SUMMARY_COPY, true)).toBe(
      '2 note(s) selected, regenerated'
    );
  });

  it('is unchanged when not regenerated', () => {
    expect(selectionSummaryLabel(sel, SUMMARY_COPY, false)).toBe(
      '2 note(s) selected'
    );
    expect(selectionSummaryLabel(sel, SUMMARY_COPY)).toBe('2 note(s) selected');
  });

  it('marks measure and track selections too', () => {
    expect(
      selectionSummaryLabel(
        { eventIds: [], measureIds: ['m'], trackIds: [] },
        SUMMARY_COPY,
        true
      )
    ).toBe('1 measure(s) selected, regenerated');
    expect(
      selectionSummaryLabel(
        { eventIds: [], measureIds: [], trackIds: ['t'] },
        SUMMARY_COPY,
        true
      )
    ).toBe('1 track(s) selected, regenerated');
  });

  it('does not mark an empty selection', () => {
    expect(
      selectionSummaryLabel(
        { eventIds: [], measureIds: [], trackIds: [] },
        SUMMARY_COPY,
        true
      )
    ).toBe('No selection');
  });
});
