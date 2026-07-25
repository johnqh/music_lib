import { describe, expect, it } from 'vitest';
import { emptySelection } from './types';
import type { ScoreRange, ScoreSelection } from './types';

describe('emptySelection', () => {
  it('returns empty arrays for eventIds, measureIds, and trackIds, and no range', () => {
    const selection: ScoreSelection = emptySelection();
    expect(selection).toEqual({ eventIds: [], measureIds: [], trackIds: [] });
    expect(selection.range).toBeUndefined();
  });

  it('returns a fresh object each call (not shared/mutable state)', () => {
    const a = emptySelection();
    const b = emptySelection();
    a.eventIds.push('event-1');
    expect(b.eventIds).toEqual([]);
  });
});

describe('ScoreRange', () => {
  it('shapes a tick range scoped to a set of tracks', () => {
    const range: ScoreRange = { startTick: 0, endTick: 1920, trackIds: ['track-1'] };
    expect(range.endTick).toBeGreaterThan(range.startTick);
  });
});
