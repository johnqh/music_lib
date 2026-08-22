import { describe, expect, it } from 'vitest';
import { twinkleScore } from '../../index.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent } from '@sudobility/music_types';
import { scoreWithPitch, stepsForDrag } from './pitch-drag.js';

describe('stepsForDrag', () => {
  it('counts staff positions upward as the pointer moves up', () => {
    // Screen y grows downward while the staff counts upward, so the sign flips.
    expect(stepsForDrag(-5, 1)).toBe(1);
    expect(stepsForDrag(5, 1)).toBe(-1);
  });

  it('settles on the nearest position rather than waiting to pass one', () => {
    expect(stepsForDrag(-3, 1)).toBe(1);
    expect(stepsForDrag(-2, 1)).toBe(0);
  });

  it('scales with zoom, so a drag tracks what is on screen', () => {
    expect(stepsForDrag(-10, 2)).toBe(1);
    expect(stepsForDrag(-5, 2)).toBe(1); // 5px at 2x is half a position -> rounds to 1
    expect(stepsForDrag(-20, 2)).toBe(2);
  });

  it('treats a nonsense zoom as 1 rather than dividing by zero', () => {
    expect(stepsForDrag(-5, 0)).toBe(1);
  });
});

describe('scoreWithPitch', () => {
  function firstNote(score = twinkleScore()) {
    const measure = score.tracks[0].measures[0];
    return measure.voices[0].events.find(isNoteEvent) as NoteEvent;
  }

  it('replaces just that note pitch', () => {
    const score = twinkleScore();
    const note = firstNote(score);
    const next = scoreWithPitch(score, note.id, {
      step: 'G',
      accidental: 1,
      octave: 5,
    });

    const updated = next.tracks[0].measures[0].voices[0].events.find(
      e => e.id === note.id
    ) as NoteEvent;
    expect(updated.pitch).toEqual({ step: 'G', accidental: 1, octave: 5 });
  });

  it('leaves the original untouched', () => {
    const score = twinkleScore();
    const note = firstNote(score);
    const before = note.pitch;
    scoreWithPitch(score, note.id, { step: 'A', accidental: 0, octave: 3 });
    expect(firstNote(score).pitch).toEqual(before);
  });

  it('shares every branch it did not touch, so a preview is cheap', () => {
    // This runs while the pointer is down; copying the score would be waste.
    const score = twinkleScore();
    const note = firstNote(score);
    const next = scoreWithPitch(score, note.id, {
      step: 'B',
      accidental: 0,
      octave: 4,
    });

    expect(next).not.toBe(score);
    expect(next.tracks[0].measures[1]).toBe(score.tracks[0].measures[1]);
    if (score.tracks.length > 1) expect(next.tracks[1]).toBe(score.tracks[1]);
  });

  it('returns the same score for an unknown id', () => {
    const score = twinkleScore();
    expect(
      scoreWithPitch(score, 'nope', { step: 'C', accidental: 0, octave: 4 })
    ).toBe(score);
  });
});
