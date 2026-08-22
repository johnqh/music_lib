import { describe, expect, it } from 'vitest';
import {
  chordScore,
  stressScore,
  twinkleScore,
  twoTrackScore,
} from './fixtures.js';
import { parseScore } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { allNotes } from '@sudobility/music_types';

describe('twinkleScore', () => {
  it('is a valid Score with 8 measures on a single piano track', () => {
    const score = twinkleScore();
    expect(() => parseScore(score)).not.toThrow();
    expect(score.tracks).toHaveLength(1);
    expect(score.tracks[0].instrumentName).toBe('Piano');
    expect(score.tracks[0].measures).toHaveLength(8);
  });

  it('uses only diatonic C-major pitches (no accidentals)', () => {
    const score = twinkleScore();
    const notes = allNotes(score);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note.pitch.accidental).toBe(0);
    }
  });

  it('is deterministic: two calls produce structurally identical scores', () => {
    expect(twinkleScore()).toEqual(twinkleScore());
  });
});

describe('twoTrackScore', () => {
  it('has a treble melody track and a bass line track', () => {
    const score = twoTrackScore();
    expect(score.tracks).toHaveLength(2);
    expect(score.tracks.map(t => t.clef).sort()).toEqual(['bass', 'treble']);
    expect(() => parseScore(score)).not.toThrow();
  });

  it('is deterministic', () => {
    expect(twoTrackScore()).toEqual(twoTrackScore());
  });
});

describe('chordScore', () => {
  it('fills each measure with multiple simultaneous notes (a block chord)', () => {
    const score = chordScore();
    expect(() => parseScore(score)).not.toThrow();
    for (const measure of score.tracks[0].measures) {
      const [voice] = measure.voices;
      expect(voice.events.length).toBeGreaterThan(1);
      const startTicks = new Set(
        voice.events.filter(isNoteEvent).map(e => e.startTick)
      );
      expect(startTicks.size).toBe(1); // all notes in the chord start together
    }
  });

  it('is deterministic', () => {
    expect(chordScore()).toEqual(chordScore());
  });
});

describe('stressScore', () => {
  it('generates the requested number of tracks and measures per track', () => {
    const score = stressScore(3, 5);
    expect(score.tracks).toHaveLength(3);
    for (const track of score.tracks) {
      expect(track.measures).toHaveLength(5);
    }
    expect(() => parseScore(score)).not.toThrow();
  });

  it('is deterministic', () => {
    expect(stressScore(2, 4)).toEqual(stressScore(2, 4));
  });

  it('generates unique ids for every measure, voice, and event', () => {
    const score = stressScore(2, 3);
    const ids = new Set<string>();
    for (const track of score.tracks) {
      ids.add(track.id);
      for (const measure of track.measures) {
        ids.add(measure.id);
        for (const voice of measure.voices) {
          ids.add(voice.id);
          for (const event of voice.events) {
            ids.add(event.id);
          }
        }
      }
    }
    const totalCount =
      score.tracks.length +
      score.tracks.reduce(
        (sum, t) =>
          sum +
          t.measures.length +
          t.measures.reduce(
            (s, m) => s + m.voices.length + allEventCount(m),
            0
          ),
        0
      );
    expect(ids.size).toBe(totalCount);
  });

  it('handles a larger size without excessive slowness (perf-fixture sanity check)', () => {
    const start = performance.now();
    const score = stressScore(10, 50);
    const elapsed = performance.now() - start;
    expect(score.tracks).toHaveLength(10);
    expect(elapsed).toBeLessThan(2000);
  });
});

function allEventCount(
  measure: ReturnType<typeof stressScore>['tracks'][number]['measures'][number]
): number {
  return measure.voices.reduce((sum, v) => sum + v.events.length, 0);
}
