/**
 * A fermata sounding, as a local slowing. These pin the two things that make
 * the approach safe: an unmarked score is untouched, and the notes keep their
 * written ticks so nothing downstream of the score tick moves.
 */
import { describe, expect, it } from 'vitest';
import type { NoteEvent, Score } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { twinkleScore } from '../../test/fixtures.js';
import { TempoMap } from '../time/tempo-map.js';
import { fermataTempoMap } from './fermata-tempo.js';
import { flattenScoreNotes } from './flatten.js';

/** Marks the note at `noteIndex` of the first track with a fermata. */
function held(noteIndex: number, score: Score = twinkleScore()): Score {
  const notes = score.tracks[0].measures
    .flatMap(m => m.voices.flatMap(v => v.events))
    .filter(isNoteEvent);
  const target = notes[noteIndex] as NoteEvent;
  return {
    ...score,
    tracks: score.tracks.map((track, i) =>
      i !== 0
        ? track
        : {
            ...track,
            measures: track.measures.map(m => ({
              ...m,
              voices: m.voices.map(v => ({
                ...v,
                events: v.events.map(e =>
                  e.id === target.id ? { ...e, fermata: true } : e
                ),
              })),
            })),
          }
    ),
  };
}

function firstNote(score: Score): NoteEvent {
  return score.tracks[0].measures
    .flatMap(m => m.voices.flatMap(v => v.events))
    .filter(isNoteEvent)[0] as NoteEvent;
}

describe('fermataTempoMap', () => {
  it('returns the score’s own array, by identity, when nothing is held', () => {
    // Not merely equal: an unmarked score must not even rebuild its map, so a
    // `TempoMap` built from it is the same object graph it always was.
    const score = twinkleScore();
    expect(fermataTempoMap(score)).toBe(score.tempoMap);
  });

  it('slows the tempo across the held note', () => {
    const score = held(0);
    const note = firstNote(score);
    const map = new TempoMap(fermataTempoMap(score), score.ppq);
    const plain = new TempoMap(score.tempoMap, score.ppq);

    expect(map.bpmAt(note.startTick)).toBeLessThan(plain.bpmAt(note.startTick));
  });

  it('restores the tempo after the held note', () => {
    const score = held(0);
    const note = firstNote(score);
    const map = new TempoMap(fermataTempoMap(score), score.ppq);
    const plain = new TempoMap(score.tempoMap, score.ppq);
    const after = note.startTick + note.durationTicks;

    expect(map.bpmAt(after)).toBeCloseTo(plain.bpmAt(after), 5);
  });

  it('makes the held note take longer in real seconds', () => {
    // The audible claim, stated in the unit the listener actually experiences.
    const score = held(0);
    const note = firstNote(score);
    const seconds = (events: ReturnType<typeof fermataTempoMap>) => {
      const map = new TempoMap(events, score.ppq);
      return (
        map.ticksToSeconds(note.startTick + note.durationTicks) -
        map.ticksToSeconds(note.startTick)
      );
    };

    expect(seconds(fermataTempoMap(score))).toBeCloseTo(
      seconds(score.tempoMap) * 2,
      4
    );
  });

  it('delays everything after the pause, and nothing before it', () => {
    const score = held(1);
    const notes = score.tracks[0].measures
      .flatMap(m => m.voices.flatMap(v => v.events))
      .filter(isNoteEvent);
    const heldNote = notes[1] as NoteEvent;
    const plain = new TempoMap(score.tempoMap, score.ppq);
    const paused = new TempoMap(fermataTempoMap(score), score.ppq);

    expect(paused.ticksToSeconds(heldNote.startTick)).toBeCloseTo(
      plain.ticksToSeconds(heldNote.startTick),
      5
    );
    const last = notes[notes.length - 1] as NoteEvent;
    expect(paused.ticksToSeconds(last.startTick)).toBeGreaterThan(
      plain.ticksToSeconds(last.startTick)
    );
  });

  it('treats one pause written into several parts as one pause', () => {
    // A fermata is observed by the whole ensemble at once, and the pause ends
    // when the LONGEST held note ends. Without merging, the short part's
    // restoring event lands inside the long part's hold and cuts it short —
    // which sounds like the pause simply not happening.
    const ppq = 480;
    const long = 1920;
    const short = 480;
    const mk = (
      durationTicks: number,
      trackId: string
    ): Score['tracks'][number] => ({
      id: trackId,
      name: trackId,
      instrumentName: 'Piano',
      midiProgram: 0,
      midiChannel: 0,
      clef: 'treble',
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      measures: [
        {
          id: `${trackId}-m0`,
          index: 0,
          startTick: 0,
          durationTicks: long,
          timeSignature: { numerator: 4, denominator: 4 },
          keySignature: { fifths: 0, mode: 'major' },
          voices: [
            {
              id: `${trackId}-v0`,
              name: 'Voice 1',
              events: [
                {
                  id: `${trackId}-n0`,
                  pitch: { step: 'C', accidental: 0, octave: 4 },
                  startTick: 0,
                  durationTicks,
                  velocity: 80,
                  voiceId: `${trackId}-v0`,
                  trackId,
                  fermata: true,
                },
              ],
            },
          ],
        },
      ],
    });

    const score: Score = {
      id: 's',
      version: 1,
      ppq,
      metadata: {
        title: 'Held',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      tempoMap: [{ id: 't0', tick: 0, bpm: 120 }],
      tracks: [mk(long, 'a'), mk(short, 'b')],
    };

    const paused = new TempoMap(fermataTempoMap(score), ppq);
    const plain = new TempoMap(score.tempoMap, ppq);

    // Still slowed well past where the SHORT note ended.
    expect(paused.bpmAt(short + 1)).toBeLessThan(plain.bpmAt(short + 1));
    expect(paused.bpmAt(long - 1)).toBeLessThan(plain.bpmAt(long - 1));
    // And restored once the long one has.
    expect(paused.bpmAt(long)).toBeCloseTo(plain.bpmAt(long), 5);
  });

  it('does not move a single note', () => {
    // The whole reason a pause is tempo and not geometry: the score tick stays
    // the playback tick, so the caret, the scrubber and "play from here" need
    // no notion of a fermata at all.
    const plain = flattenScoreNotes(twinkleScore());
    const paused = flattenScoreNotes(held(0));
    expect(paused.map(n => n.tick)).toEqual(plain.map(n => n.tick));
    expect(paused.map(n => n.durTicks)).toEqual(plain.map(n => n.durTicks));
  });
});
