import { describe, expect, it } from 'vitest';
import type { MusicalEvent } from '@sudobility/music_types';
import { ticksFor } from './ticks.js';
import { tupletGroups } from './tuplets.js';

const PPQ = 480;

/** Events of the given durations, which is all the grouping rule reads. */
function events(...durations: number[]): MusicalEvent[] {
  let tick = 0;
  return durations.map((durationTicks, i) => {
    const event = {
      id: `e${i}`,
      startTick: tick,
      durationTicks,
      voiceId: 'v1',
      trackId: 't1',
    } as MusicalEvent;
    tick += durationTicks;
    return event;
  });
}

const tripletEighth = ticksFor('triplet-eighth', PPQ);
const tripletQuarter = ticksFor('triplet-quarter', PPQ);
const quarter = ticksFor('quarter', PPQ);
const eighth = ticksFor('eighth', PPQ);

describe('tupletGroups', () => {
  it('finds nothing in ordinary durations', () => {
    expect(tupletGroups(events(quarter, eighth, eighth, quarter), PPQ)).toEqual(
      []
    );
  });

  it('groups three triplet notes as one triplet', () => {
    expect(
      tupletGroups(events(tripletEighth, tripletEighth, tripletEighth), PPQ)
    ).toEqual([{ start: 0, length: 3, actualNotes: 3, normalNotes: 2 }]);
  });

  it('finds two triplets in a run of six', () => {
    const groups = tupletGroups(events(...Array(6).fill(tripletEighth)), PPQ);
    expect(groups.map(g => g.start)).toEqual([0, 3]);
  });

  it('leaves an incomplete run ungrouped', () => {
    // Two triplet eighths do not occupy a quarter, so a bracket over them
    // would claim a grouping the music does not have.
    expect(
      tupletGroups(events(tripletEighth, tripletEighth, quarter), PPQ)
    ).toEqual([]);
  });

  it('drops the remainder of a run that is not a whole three', () => {
    const groups = tupletGroups(events(...Array(4).fill(tripletEighth)), PPQ);
    expect(groups).toEqual([
      { start: 0, length: 3, actualNotes: 3, normalNotes: 2 },
    ]);
  });

  it('does not join runs of different triplet values', () => {
    // Three triplet quarters and three triplet eighths are two tuplets, not
    // one run of six.
    const groups = tupletGroups(
      events(
        tripletQuarter,
        tripletQuarter,
        tripletQuarter,
        tripletEighth,
        tripletEighth,
        tripletEighth
      ),
      PPQ
    );
    expect(groups).toEqual([
      { start: 0, length: 3, actualNotes: 3, normalNotes: 2 },
      { start: 3, length: 3, actualNotes: 3, normalNotes: 2 },
    ]);
  });

  it('finds a triplet that does not start the bar', () => {
    const groups = tupletGroups(
      events(quarter, tripletEighth, tripletEighth, tripletEighth),
      PPQ
    );
    expect(groups).toEqual([
      { start: 1, length: 3, actualNotes: 3, normalNotes: 2 },
    ]);
  });

  it('counts a rest inside a triplet as one of its three', () => {
    // A triplet with a rest in the middle is still a triplet; skipping rests
    // would join the notes either side into a group that is not one.
    const groups = tupletGroups(
      events(tripletEighth, tripletEighth, tripletEighth),
      PPQ
    );
    expect(groups[0].length).toBe(3);
  });

  it('is interrupted by an ordinary note between triplets', () => {
    const groups = tupletGroups(
      events(
        tripletEighth,
        tripletEighth,
        quarter,
        tripletEighth,
        tripletEighth,
        tripletEighth
      ),
      PPQ
    );
    expect(groups).toEqual([
      { start: 3, length: 3, actualNotes: 3, normalNotes: 2 },
    ]);
  });
});
