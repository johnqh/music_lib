import { describe, expect, it } from 'vitest';
import type { Dynamic, NoteEvent } from '@sudobility/music_types';
import { twinkleScore, twoTrackScore } from '../../test/fixtures.js';
import { flattenScoreNotes } from './flatten.js';
import {
  DEFAULT_VELOCITY,
  dynamicsInForce,
  effectiveVelocity,
  velocityForDynamic,
} from './dynamics.js';

function note(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: 'n1',
    pitch: { step: 'C', accidental: 0, octave: 4 },
    startTick: 0,
    durationTicks: 480,
    velocity: DEFAULT_VELOCITY,
    voiceId: 'v1',
    trackId: 't1',
    ...overrides,
  };
}

/** Marks the first note of a score, so a whole track plays at that dynamic. */
function scoreMarked(dynamic: Dynamic) {
  const score = twinkleScore();
  const measure = score.tracks[0].measures[0];
  return {
    ...score,
    tracks: score.tracks.map((track, i) =>
      i !== 0
        ? track
        : {
            ...track,
            measures: track.measures.map(m =>
              m.id !== measure.id
                ? m
                : {
                    ...m,
                    voices: m.voices.map(v => ({
                      ...v,
                      events: v.events.map((e, index) =>
                        index === 0 && 'pitch' in e ? { ...e, dynamic } : e
                      ),
                    })),
                  }
            ),
          }
    ),
  };
}

describe('velocityForDynamic', () => {
  it('climbs from ppp to fff', () => {
    const ladder: Dynamic[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
    const velocities = ladder.map(velocityForDynamic);
    for (let i = 1; i < velocities.length; i++) {
      expect(velocities[i]).toBeGreaterThan(velocities[i - 1]);
    }
    expect(velocities.at(-1)).toBeLessThanOrEqual(127);
  });

  it('puts mf at the default, which is what leaves an unmarked score alone', () => {
    expect(velocityForDynamic('mf')).toBe(DEFAULT_VELOCITY);
  });
});

describe('effectiveVelocity', () => {
  it('leaves a note alone when no dynamic is in force', () => {
    expect(effectiveVelocity(note({ velocity: 53 }), null)).toBe(53);
  });

  it('plays a default note at the marked dynamic', () => {
    expect(effectiveVelocity(note(), 'ff')).toBe(velocityForDynamic('ff'));
    expect(effectiveVelocity(note(), 'pp')).toBe(velocityForDynamic('pp'));
  });

  it('keeps an accent as an accent inside the dynamic', () => {
    // A note written 20 above the default stays 20 above, wherever the passage
    // sits — which is why the written velocity is a deviation rather than
    // being overwritten.
    const accented = note({ velocity: DEFAULT_VELOCITY + 20 });
    expect(effectiveVelocity(accented, 'p')).toBe(velocityForDynamic('p') + 20);
  });

  it('never leaves the audible range', () => {
    expect(effectiveVelocity(note({ velocity: 127 }), 'fff')).toBe(127);
    expect(
      effectiveVelocity(note({ velocity: 1 }), 'ppp')
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('dynamicsInForce', () => {
  it('carries a marking forward until the next one', () => {
    const events = [
      note({ id: 'a', dynamic: 'p', startTick: 0 }),
      note({ id: 'b', startTick: 480 }),
      note({ id: 'c', dynamic: 'f', startTick: 960 }),
      note({ id: 'd', startTick: 1440 }),
    ];
    const inForce = dynamicsInForce(events);
    expect(inForce.get('a')).toBe('p');
    expect(inForce.get('b')).toBe('p');
    expect(inForce.get('c')).toBe('f');
    expect(inForce.get('d')).toBe('f');
  });

  it('leaves notes before the first marking unmarked', () => {
    const events = [
      note({ id: 'a' }),
      note({ id: 'b', dynamic: 'f', startTick: 480 }),
    ];
    const inForce = dynamicsInForce(events);
    expect(inForce.has('a')).toBe(false);
    expect(inForce.get('b')).toBe('f');
  });
});

describe('flattenScoreNotes with dynamics', () => {
  it('plays an unmarked score exactly as before', () => {
    // The guarantee that makes this change safe to land on existing scores.
    const notes = flattenScoreNotes(twinkleScore());
    expect(notes.every(n => n.velocity === DEFAULT_VELOCITY)).toBe(true);
  });

  it('makes a marking audible, not decorative', () => {
    const quiet = flattenScoreNotes(scoreMarked('pp'));
    const loud = flattenScoreNotes(scoreMarked('ff'));

    expect(quiet[0].velocity).toBe(velocityForDynamic('pp'));
    expect(loud[0].velocity).toBe(velocityForDynamic('ff'));
    expect(loud[0].velocity).toBeGreaterThan(quiet[0].velocity);
  });

  it('carries the marking through the rest of the track', () => {
    const notes = flattenScoreNotes(scoreMarked('ff'));
    const firstTrack = notes.filter(
      n => n.trackId === scoreMarked('ff').tracks[0].id
    );
    expect(firstTrack.length).toBeGreaterThan(4);
    expect(firstTrack.every(n => n.velocity === velocityForDynamic('ff'))).toBe(
      true
    );
  });

  it('leaves the other tracks alone', () => {
    // A dynamic governs its own track. Marking the top line does not make the
    // accompaniment loud. Needs a fixture with more than one track — twinkle
    // is a single line, drawn across two systems.
    const base = twoTrackScore();
    const marked = {
      ...base,
      tracks: base.tracks.map((track, i) =>
        i !== 0
          ? track
          : {
              ...track,
              measures: track.measures.map((m, mi) =>
                mi !== 0
                  ? m
                  : {
                      ...m,
                      voices: m.voices.map(v => ({
                        ...v,
                        events: v.events.map((e, index) =>
                          index === 0 && 'pitch' in e
                            ? { ...e, dynamic: 'ff' as const }
                            : e
                        ),
                      })),
                    }
              ),
            }
      ),
    };

    const notes = flattenScoreNotes(marked);
    const others = notes.filter(n => n.trackId !== marked.tracks[0].id);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every(n => n.velocity === DEFAULT_VELOCITY)).toBe(true);
  });
});
