/**
 * A crescendo sounding. The claim is that velocity *moves* across the span —
 * a hairpin that resolved to a single level would be a dynamic, not a wedge.
 */
import { describe, expect, it } from 'vitest';
import type { Score } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { twinkleScore } from '../../test/fixtures.js';
import { toggleHairpinCommand } from '../commands/note-commands.js';
import { changeDynamicCommand } from '../commands/note-commands.js';
import { flattenScoreNotes } from './flatten.js';

const trackId = twinkleScore().tracks[0].id;

function noteIds(score: Score, count: number): string[] {
  return score.tracks[0].measures
    .flatMap(m => m.voices.flatMap(v => v.events))
    .filter(isNoteEvent)
    .slice(0, count)
    .map(n => n.id);
}

function velocities(score: Score, ids: string[]): number[] {
  const flat = flattenScoreNotes(score).filter(n => n.trackId === trackId);
  return ids.map(id => flat.find(n => n.noteId === id)!.velocity);
}

describe('hairpins in flattenScoreNotes', () => {
  it('ramps velocity upward across a crescendo', () => {
    const score = twinkleScore();
    const ids = noteIds(score, 4);
    const marked = toggleHairpinCommand(ids, 'crescendo', 'Cresc').execute(
      score
    );
    const vs = velocities(marked, ids);

    expect(vs[0]).toBeLessThan(vs[vs.length - 1]);
    for (let i = 1; i < vs.length; i += 1) {
      expect(vs[i]).toBeGreaterThanOrEqual(vs[i - 1]);
    }
  });

  it('ramps downward across a diminuendo', () => {
    const score = twinkleScore();
    const ids = noteIds(score, 4);
    const marked = toggleHairpinCommand(ids, 'diminuendo', 'Dim').execute(
      score
    );
    const vs = velocities(marked, ids);

    expect(vs[0]).toBeGreaterThan(vs[vs.length - 1]);
  });

  it('arrives at the next written dynamic', () => {
    // What a player does: the wedge takes you to the next marking.
    const score = twinkleScore();
    const ids = noteIds(score, 5);
    const marked = changeDynamicCommand([ids[4]], 'ff', 'ff').execute(
      changeDynamicCommand([ids[0]], 'pp', 'pp').execute(
        toggleHairpinCommand(ids.slice(0, 4), 'crescendo', 'Cresc').execute(
          score
        )
      )
    );
    const vs = velocities(marked, ids);

    // The last note of the span reaches the level the next note states.
    expect(vs[3]).toBe(vs[4]);
    expect(vs[0]).toBeLessThan(vs[3]);
  });

  it('leaves notes outside the span alone', () => {
    const score = twinkleScore();
    const ids = noteIds(score, 6);
    const marked = toggleHairpinCommand(
      ids.slice(0, 3),
      'crescendo',
      'Cresc'
    ).execute(score);

    const before = velocities(score, ids);
    const after = velocities(marked, ids);
    expect(after.slice(3)).toEqual(before.slice(3));
  });

  it('changes nothing for a score with no hairpin', () => {
    const score = twinkleScore();
    const ids = noteIds(score, 6);
    expect(velocities(score, ids)).toEqual(ids.map(() => 80));
  });
});
