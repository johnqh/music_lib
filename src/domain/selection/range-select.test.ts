import { describe, expect, it } from 'vitest';
import { twinkleScore, twoTrackScore } from '../../index.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent, Score } from '@sudobility/music_types';
import { noteIdsInTickRange } from '../selection/range-select.js';

/** Every note on one track, in tick order — expectations derive from the fixture rather than hardcoding ids. */
function notesOf(score: Score, trackIndex = 0): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const measure of score.tracks[trackIndex].measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (isNoteEvent(event)) out.push(event);
      }
    }
  }
  return out.sort((a, b) => a.startTick - b.startTick);
}

describe('noteIdsInTickRange', () => {
  it('selects notes whose startTick is inside the range', () => {
    const score = twinkleScore();
    const notes = notesOf(score);
    const ids = noteIdsInTickRange(
      score,
      notes[0].startTick,
      notes[2].startTick,
      [score.tracks[0].id]
    );
    expect(ids).toContain(notes[0].id);
    expect(ids).toContain(notes[1].id);
  });

  it('is half-open: a note starting exactly at the end tick is excluded', () => {
    const score = twinkleScore();
    const notes = notesOf(score);
    const ids = noteIdsInTickRange(
      score,
      notes[0].startTick,
      notes[2].startTick,
      [score.tracks[0].id]
    );
    expect(ids).not.toContain(notes[2].id);
  });

  it('includes a note starting exactly at the start tick', () => {
    const score = twinkleScore();
    const notes = notesOf(score);
    const ids = noteIdsInTickRange(
      score,
      notes[1].startTick,
      notes[3].startTick,
      [score.tracks[0].id]
    );
    expect(ids).toContain(notes[1].id);
  });

  it('accepts a reversed range', () => {
    const score = twinkleScore();
    const notes = notesOf(score);
    const trackId = score.tracks[0].id;
    const forward = noteIdsInTickRange(
      score,
      notes[0].startTick,
      notes[2].startTick,
      [trackId]
    );
    const backward = noteIdsInTickRange(
      score,
      notes[2].startTick,
      notes[0].startTick,
      [trackId]
    );
    expect(backward).toEqual(forward);
  });

  it('returns nothing for an empty span', () => {
    const score = twinkleScore();
    const notes = notesOf(score);
    expect(
      noteIdsInTickRange(score, notes[0].startTick, notes[0].startTick, [
        score.tracks[0].id,
      ])
    ).toEqual([]);
  });

  it('returns nothing when no tracks are named', () => {
    const score = twinkleScore();
    expect(noteIdsInTickRange(score, 0, Number.MAX_SAFE_INTEGER, [])).toEqual(
      []
    );
  });

  it('only returns notes on the named tracks', () => {
    const score = twoTrackScore();
    const trackZeroIds = new Set(notesOf(score, 0).map(n => n.id));
    const ids = noteIdsInTickRange(score, 0, Number.MAX_SAFE_INTEGER, [
      score.tracks[0].id,
    ]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(trackZeroIds.has(id)).toBe(true);
  });

  it('spans multiple tracks when several are named', () => {
    const score = twoTrackScore();
    const ids = noteIdsInTickRange(score, 0, Number.MAX_SAFE_INTEGER, [
      score.tracks[0].id,
      score.tracks[1].id,
    ]);
    const trackOneIds = new Set(notesOf(score, 1).map(n => n.id));
    expect(ids.some(id => trackOneIds.has(id))).toBe(true);
  });

  it('returns ids in ascending tick order', () => {
    const score = twinkleScore();
    const notes = notesOf(score);
    const byId = new Map(notes.map(n => [n.id, n.startTick]));
    const ids = noteIdsInTickRange(score, 0, Number.MAX_SAFE_INTEGER, [
      score.tracks[0].id,
    ]);
    const ticks = ids.map(id => byId.get(id)!);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it('skips rests, returning only note events', () => {
    const score = twinkleScore();
    const noteIds = new Set(notesOf(score).map(n => n.id));
    const ids = noteIdsInTickRange(score, 0, Number.MAX_SAFE_INTEGER, [
      score.tracks[0].id,
    ]);
    for (const id of ids) expect(noteIds.has(id)).toBe(true);
  });
});
