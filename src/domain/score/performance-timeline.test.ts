import { describe, expect, it } from 'vitest';
import type { Measure, Score } from '@sudobility/music_types';
import {
  performanceTickFor,
  performanceTimeline,
  sourceTickFor,
} from './performance-timeline.js';

const BAR = 1920;

function scoreWith(
  count: number,
  markings: Record<number, Partial<Measure>> = {}
): Score {
  return {
    id: 's',
    version: 1,
    ppq: 480,
    metadata: { title: 'T', createdAt: '', updatedAt: '' },
    tempoMap: [{ id: 't', tick: 0, bpm: 120 }],
    tracks: [
      {
        id: 'tr',
        measures: Array.from({ length: count }, (_, index) => ({
          id: `m${index}`,
          index,
          startTick: index * BAR,
          durationTicks: BAR,
          timeSignature: { numerator: 4, denominator: 4 },
          keySignature: { fifths: 0, mode: 'major' },
          voices: [],
          ...(markings[index] ?? {}),
        })),
      },
    ],
  } as unknown as Score;
}

describe('performanceTimeline', () => {
  it('is the identity for a score with no repeats', () => {
    // The property that keeps every existing behaviour unchanged.
    const timeline = performanceTimeline(scoreWith(4));
    expect(timeline.segments).toHaveLength(1);
    expect(timeline.segments[0]).toEqual({
      performanceTick: 0,
      sourceTick: 0,
      durationTicks: 4 * BAR,
    });
    expect(timeline.durationTicks).toBe(4 * BAR);
  });

  it('is longer than the score when something repeats', () => {
    const timeline = performanceTimeline(
      scoreWith(4, { 0: { repeatStart: true }, 1: { repeatEnd: true } })
    );
    // Six bars played from four written.
    expect(timeline.durationTicks).toBe(6 * BAR);
  });
});

describe('sourceTickFor', () => {
  it('is the identity without repeats', () => {
    const timeline = performanceTimeline(scoreWith(4));
    for (const tick of [0, 100, BAR, 3 * BAR + 5]) {
      expect(sourceTickFor(timeline, tick)).toBe(tick);
    }
  });

  it('maps the second pass back onto the written bars', () => {
    // The whole point: the caret must point at bar 1 again on the way round,
    // not run off the end of the score.
    const timeline = performanceTimeline(
      scoreWith(4, { 0: { repeatStart: true }, 1: { repeatEnd: true } })
    );
    expect(sourceTickFor(timeline, 0)).toBe(0);
    expect(sourceTickFor(timeline, 2 * BAR)).toBe(0); // second pass, bar 1
    expect(sourceTickFor(timeline, 3 * BAR)).toBe(BAR); // second pass, bar 2
    expect(sourceTickFor(timeline, 4 * BAR)).toBe(2 * BAR); // on to bar 3
  });

  it('clamps past the end rather than vanishing', () => {
    // The engine can report a hair past the final note; the caret should sit
    // at the end rather than disappear.
    const timeline = performanceTimeline(scoreWith(2));
    expect(sourceTickFor(timeline, 99 * BAR)).toBe(2 * BAR - 1);
  });
});

describe('performanceTickFor', () => {
  it('is the identity without repeats', () => {
    const timeline = performanceTimeline(scoreWith(4));
    expect(performanceTickFor(timeline, 2 * BAR)).toBe(2 * BAR);
  });

  it('starts at the first time a bar is played', () => {
    // Clicking bar 1 and pressing play starts the first time through, which
    // is what "play from here" means to someone reading the page.
    const timeline = performanceTimeline(
      scoreWith(4, { 0: { repeatStart: true }, 1: { repeatEnd: true } })
    );
    expect(performanceTickFor(timeline, 0)).toBe(0);
    expect(performanceTickFor(timeline, BAR)).toBe(BAR);
    // Bar 3 is written at 2*BAR but first performed after the repeat.
    expect(performanceTickFor(timeline, 2 * BAR)).toBe(4 * BAR);
  });

  it('round-trips a written position through both directions', () => {
    const timeline = performanceTimeline(
      scoreWith(5, {
        0: { repeatStart: true },
        2: { endingNumbers: [1], repeatEnd: true },
        3: { endingNumbers: [2] },
      })
    );
    for (const sourceTick of [0, BAR, 2 * BAR, 3 * BAR, 4 * BAR]) {
      expect(
        sourceTickFor(timeline, performanceTickFor(timeline, sourceTick))
      ).toBe(sourceTick);
    }
  });
});
