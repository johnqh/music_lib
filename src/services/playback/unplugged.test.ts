import { describe, expect, it } from 'vitest';
import { threeTrackScore, twinkleScore } from '@sudobility/music_types/test';
import {
  defaultUnpluggedListener,
  defaultUnpluggedTrackPositions,
  effectiveUnpluggedArrangement,
  UNPLUGGED_RADIUS,
  unpluggedMixes,
  unpluggedMixFor,
} from './unplugged';

describe('defaultUnpluggedListener', () => {
  it('starts at the centre, facing straight ahead', () => {
    expect(defaultUnpluggedListener()).toEqual({ x: 0, z: 0, facingDeg: 0 });
  });
});

describe('defaultUnpluggedTrackPositions', () => {
  it('puts a single track dead ahead', () => {
    const positions = defaultUnpluggedTrackPositions(['a']);
    expect(positions.a.x).toBeCloseTo(0);
    expect(positions.a.z).toBeCloseTo(UNPLUGGED_RADIUS);
  });

  it('spreads three tracks across dead left, ahead, and dead right', () => {
    const positions = defaultUnpluggedTrackPositions(['a', 'b', 'c']);
    expect(positions.a.x).toBeCloseTo(-UNPLUGGED_RADIUS);
    expect(positions.a.z).toBeCloseTo(0);
    expect(positions.b.x).toBeCloseTo(0);
    expect(positions.b.z).toBeCloseTo(UNPLUGGED_RADIUS);
    expect(positions.c.x).toBeCloseTo(UNPLUGGED_RADIUS);
    expect(positions.c.z).toBeCloseTo(0);
  });

  it('keeps every track on the circle, at the given radius', () => {
    const positions = defaultUnpluggedTrackPositions(['a', 'b', 'c', 'd'], 10);
    for (const { x, z } of Object.values(positions)) {
      expect(Math.hypot(x, z)).toBeCloseTo(10);
    }
  });
});

describe('effectiveUnpluggedArrangement', () => {
  it('is the computed default on a score that has never been touched', () => {
    const score = threeTrackScore();
    const arrangement = effectiveUnpluggedArrangement(score);
    expect(arrangement.listener).toEqual(defaultUnpluggedListener());
    expect(Object.keys(arrangement.tracks)).toEqual(
      score.tracks.map(track => track.id)
    );
  });

  it('layers saved positions over the default, leaving untouched tracks alone', () => {
    const score = threeTrackScore();
    const [first, , third] = score.tracks;
    const touched = {
      ...score,
      unplugged: {
        listener: { x: 1, z: 1, facingDeg: 30 },
        tracks: { [first.id]: { x: 2, z: 2 } },
      },
    };

    const arrangement = effectiveUnpluggedArrangement(touched);
    expect(arrangement.listener).toEqual({ x: 1, z: 1, facingDeg: 30 });
    expect(arrangement.tracks[first.id]).toEqual({ x: 2, z: 2 });
    // untouched — still the computed default for this track's roster slot
    expect(arrangement.tracks[third.id]).toEqual(
      defaultUnpluggedTrackPositions(score.tracks.map(t => t.id))[third.id]
    );
  });

  it('gives a track added after the arrangement was saved a default slot', () => {
    const score = twinkleScore();
    const existingId = score.tracks[0].id;
    const withArrangement = {
      ...score,
      unplugged: {
        listener: defaultUnpluggedListener(),
        tracks: { [existingId]: { x: 3, z: 3 } },
      },
      tracks: [...score.tracks, { ...score.tracks[0], id: 'new-track' }],
    };

    const arrangement = effectiveUnpluggedArrangement(withArrangement);
    expect(arrangement.tracks[existingId]).toEqual({ x: 3, z: 3 });
    expect(arrangement.tracks['new-track']).toBeDefined();
  });
});

/*
 * The formula, pinned against the listener's own worked example: turning
 * left by 90° takes what was on the left to dead ahead, what was dead ahead
 * to the right, and what was on the right to directly behind.
 */
describe('unpluggedMixFor', () => {
  const radius = UNPLUGGED_RADIUS;

  it('is full volume and centred at zero distance', () => {
    const mix = unpluggedMixFor(
      defaultUnpluggedListener(),
      { x: 0, z: 0 },
      radius
    );
    expect(mix.volume).toBe(1);
    expect(mix.pan).toBe(0);
  });

  it('pans a point on the right to the right, and the left to the left', () => {
    const listener = defaultUnpluggedListener();
    const right = unpluggedMixFor(listener, { x: radius, z: 0 }, radius);
    const left = unpluggedMixFor(listener, { x: -radius, z: 0 }, radius);
    expect(right.pan).toBeCloseTo(1);
    expect(left.pan).toBeCloseTo(-1);
  });

  it('is quieter directly behind than dead ahead, at the same distance', () => {
    const listener = defaultUnpluggedListener();
    const ahead = unpluggedMixFor(listener, { x: 0, z: radius }, radius);
    const behind = unpluggedMixFor(listener, { x: 0, z: -radius }, radius);
    expect(ahead.volume).toBeGreaterThan(behind.volume);
    expect(behind.volume).toBeCloseTo(ahead.volume * 0.5);
  });

  it('is centre pan both dead ahead and directly behind', () => {
    const listener = defaultUnpluggedListener();
    expect(
      unpluggedMixFor(listener, { x: 0, z: radius }, radius).pan
    ).toBeCloseTo(0);
    expect(
      unpluggedMixFor(listener, { x: 0, z: -radius }, radius).pan
    ).toBeCloseTo(0);
  });

  it('gets quieter the further away a point is, down to a floor', () => {
    const listener = defaultUnpluggedListener();
    const near = unpluggedMixFor(listener, { x: 0, z: radius }, radius);
    const far = unpluggedMixFor(listener, { x: 0, z: radius * 2 }, radius);
    const beyond = unpluggedMixFor(listener, { x: 0, z: radius * 10 }, radius);
    expect(near.volume).toBeGreaterThan(far.volume);
    expect(far.volume).toBeCloseTo(0.25);
    expect(beyond.volume).toBeCloseTo(0.25);
  });

  it('turning the listener left moves what was on their left to dead ahead', () => {
    const point = { x: -radius, z: 0 }; // dead left of the default facing
    const beforeTurn = unpluggedMixFor(
      defaultUnpluggedListener(),
      point,
      radius
    );
    expect(beforeTurn.pan).toBeCloseTo(-1);

    // Turning left decreases facingDeg (clockwise-positive convention).
    const turnedLeft = { x: 0, z: 0, facingDeg: -90 };
    const afterTurn = unpluggedMixFor(turnedLeft, point, radius);
    expect(afterTurn.pan).toBeCloseTo(0);
    // Full front/back factor (now dead ahead), but the point is still one
    // radius away, so the distance factor alone still applies: 0.625.
    expect(afterTurn.volume).toBeCloseTo(0.625);
  });

  it('turning the listener left moves what was ahead to their right, and what was on their right to behind them', () => {
    const turnedLeft = { x: 0, z: 0, facingDeg: -90 };

    const wasAhead = unpluggedMixFor(turnedLeft, { x: 0, z: radius }, radius);
    expect(wasAhead.pan).toBeCloseTo(1);

    const wasRight = unpluggedMixFor(turnedLeft, { x: radius, z: 0 }, radius);
    expect(wasRight.pan).toBeCloseTo(0);
    // Now directly behind (front/back factor 0.5) and one radius away
    // (distance factor 0.625): 0.5 * 0.625 = 0.3125.
    expect(wasRight.volume).toBeCloseTo(0.3125);
  });
});

describe('unpluggedMixes', () => {
  it('gives every track in the score a mix, keyed by id', () => {
    const score = threeTrackScore();
    const mixes = unpluggedMixes(score);
    expect(Object.keys(mixes)).toEqual(score.tracks.map(track => track.id));
    for (const mix of Object.values(mixes)) {
      expect(mix.volume).toBeGreaterThanOrEqual(0);
      expect(mix.volume).toBeLessThanOrEqual(1);
      expect(mix.pan).toBeGreaterThanOrEqual(-1);
      expect(mix.pan).toBeLessThanOrEqual(1);
    }
  });
});
