/**
 * The octave bracket as a display lens.
 *
 * The mark says "written an octave away to stay on the stave". The model holds
 * sounding pitch, so the lens is what moves the noteheads — and it must move
 * them the *opposite* way from the bracket, or a reader plays two octaves out.
 */
import { describe, expect, it } from 'vitest';
import type { NoteEvent, Ottava, Score } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { twinkleScore } from '../../test/fixtures.js';
import { toggleOttavaCommand } from '../commands/note-commands.js';
import { hasOttava, ottavaScore } from './ottava.js';

function notes(score: Score): NoteEvent[] {
  return score.tracks[0].measures
    .flatMap(m => m.voices.flatMap(v => v.events))
    .filter(isNoteEvent)
    .sort((a, b) => a.startTick - b.startTick);
}

function bracketed(kind: Ottava, count = 3): Score {
  const score = twinkleScore();
  const ids = notes(score)
    .slice(0, count)
    .map(n => n.id);
  return toggleOttavaCommand(ids, kind, 'Ottava').execute(score);
}

describe('ottavaScore', () => {
  it('returns the identical object when nothing is bracketed', () => {
    // `computeLayout` is cached by score identity, so a fresh object per
    // render would re-format every VexFlow object on every frame.
    const score = twinkleScore();
    expect(ottavaScore(score)).toBe(score);
    expect(hasOttava(score)).toBe(false);
  });

  it('draws an 8va an octave LOWER than it sounds', () => {
    const marked = bracketed('8va');
    const sounding = notes(marked);
    const drawn = notes(ottavaScore(marked));

    for (let i = 0; i < 3; i += 1) {
      expect(drawn[i].pitch.octave).toBe(sounding[i].pitch.octave - 1);
    }
  });

  it('draws an 8vb an octave higher than it sounds', () => {
    const marked = bracketed('8vb');
    const sounding = notes(marked);
    const drawn = notes(ottavaScore(marked));
    expect(drawn[0].pitch.octave).toBe(sounding[0].pitch.octave + 1);
  });

  it('moves two octaves for a 15ma', () => {
    const marked = bracketed('15ma');
    const sounding = notes(marked);
    const drawn = notes(ottavaScore(marked));
    expect(drawn[0].pitch.octave).toBe(sounding[0].pitch.octave - 2);
  });

  it('leaves notes outside the bracket where they are', () => {
    const marked = bracketed('8va', 3);
    const sounding = notes(marked);
    const drawn = notes(ottavaScore(marked));

    for (let i = 3; i < sounding.length; i += 1) {
      expect(drawn[i].pitch.octave).toBe(sounding[i].pitch.octave);
    }
  });

  it('includes the closing note in its own bracket', () => {
    // The note carrying `ottavaStop` is under the bracket, not after it.
    const marked = bracketed('8va', 3);
    const sounding = notes(marked);
    const drawn = notes(ottavaScore(marked));
    expect(drawn[2].pitch.octave).toBe(sounding[2].pitch.octave - 1);
  });

  it('never changes what a note sounds like', () => {
    // The lens is for drawing only; playback reads the stored score.
    const marked = bracketed('8va');
    expect(notes(marked).map(n => n.pitch.octave)).toEqual(
      notes(bracketed('8va')).map(n => n.pitch.octave)
    );
  });
});
