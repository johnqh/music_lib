/**
 * Grace notes in playback: they sound, and they borrow from their principal
 * rather than from the bar.
 */
import { describe, expect, it } from 'vitest';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent, Score } from '@sudobility/music_types';
import { twinkleScore } from '../../test/fixtures.js';
import { toGraceNoteCommand } from '../commands/note-commands.js';
import { flattenScoreNotes } from './flatten.js';

/** Twinkle with its first note turned into an ornament on the second. */
function ornamented(): { score: Score; principal: NoteEvent } {
  const base = twinkleScore();
  const voice = base.tracks[0].measures[0].voices[0];
  const [first, second] = voice.events.filter(isNoteEvent);
  const score = toGraceNoteCommand(first.id, 'Grace').execute(base);
  const principal = score.tracks[0].measures[0].voices[0].events.find(
    (e): e is NoteEvent => e.id === second.id && isNoteEvent(e)
  )!;
  return { score, principal };
}

describe('grace notes in playback', () => {
  it('sounds the ornament before its principal', () => {
    const { score, principal } = ornamented();
    const notes = flattenScoreNotes(score);

    const grace = notes.find(n => n.noteId.includes('-grace-'));
    const played = notes.find(n => n.noteId === principal.id);

    expect(grace).toBeTruthy();
    expect(played).toBeTruthy();
    expect(grace!.tick).toBeLessThan(played!.tick);
  });

  it('takes the time from the principal, not from the bar', () => {
    // Everything after the ornamented note must stay exactly where it was, or
    // an ornament would push the rest of the piece later.
    const plain = flattenScoreNotes(twinkleScore());
    const { score, principal } = ornamented();
    const withGrace = flattenScoreNotes(score);

    // Strictly after the principal *ends* — the principal itself legitimately
    // starts later, since that is where the borrowed time comes from.
    const end = principal.startTick + principal.durationTicks;
    const after = (notes: typeof plain) =>
      notes.filter(n => n.tick >= end).map(n => n.tick);

    expect(after(withGrace)).toEqual(after(plain));
  });

  it('ends the principal where it always ended', () => {
    const { score, principal } = ornamented();
    const played = flattenScoreNotes(score).find(
      n => n.noteId === principal.id
    )!;

    expect(played.tick + played.durTicks).toBe(
      principal.startTick + principal.durationTicks
    );
  });

  it('never lets an ornament swallow more than half its note', () => {
    // A decoration that took the whole note would be a rewrite.
    const { score, principal } = ornamented();
    const grace = flattenScoreNotes(score).filter(n =>
      n.noteId.includes('-grace-')
    );
    const total = grace.reduce((sum, n) => sum + n.durTicks, 0);

    expect(total).toBeLessThanOrEqual(Math.floor(principal.durationTicks / 2));
  });

  it('leaves an unornamented score exactly as it was', () => {
    const plain = flattenScoreNotes(twinkleScore());
    expect(plain.every(n => !n.noteId.includes('-grace-'))).toBe(true);
  });
});
