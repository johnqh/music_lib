import { describe, expect, it } from 'vitest';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent } from '@sudobility/music_types';
import { fillVoiceWithRests } from './fill.js';

const PPQ = 480;
const BAR = PPQ * 4;

function note(startTick: number, durationTicks: number): NoteEvent {
  return {
    id: `n${startTick}`,
    pitch: { step: 'C', accidental: 0, octave: 4 },
    startTick,
    durationTicks,
    velocity: 80,
    voiceId: 'v',
    trackId: 't',
  };
}

/** What the validator checks: the events must tile the measure exactly. */
function covers(
  events: ReturnType<typeof fillVoiceWithRests>,
  start: number,
  duration: number
): boolean {
  let at = start;
  for (const e of events) {
    if (e.startTick !== at) return false;
    at += e.durationTicks;
  }
  return at === start + duration;
}

describe('fillVoiceWithRests', () => {
  it('fills a leading gap', () => {
    const out = fillVoiceWithRests([note(PPQ, PPQ)], 0, BAR, PPQ, 't', 'v');
    expect(covers(out, 0, BAR)).toBe(true);
    expect(isNoteEvent(out[0])).toBe(false);
  });

  it('fills a gap between notes', () => {
    const out = fillVoiceWithRests(
      [note(0, PPQ), note(PPQ * 2, PPQ)],
      0,
      BAR,
      PPQ,
      't',
      'v'
    );
    expect(covers(out, 0, BAR)).toBe(true);
    expect(out.filter(e => !isNoteEvent(e)).length).toBeGreaterThan(0);
  });

  it('fills a trailing gap', () => {
    const out = fillVoiceWithRests([note(0, PPQ)], 0, BAR, PPQ, 't', 'v');
    expect(covers(out, 0, BAR)).toBe(true);
  });

  it('returns one full-measure rest for an empty voice', () => {
    const out = fillVoiceWithRests([], 0, BAR, PPQ, 't', 'v');
    expect(covers(out, 0, BAR)).toBe(true);
    expect(out.every(e => !isNoteEvent(e))).toBe(true);
  });

  it('leaves an already-full voice alone', () => {
    const out = fillVoiceWithRests([note(0, BAR)], 0, BAR, PPQ, 't', 'v');
    expect(out).toHaveLength(1);
    expect(isNoteEvent(out[0])).toBe(true);
  });

  it('works on a measure that does not start at tick 0', () => {
    const out = fillVoiceWithRests(
      [note(BAR + PPQ, PPQ)],
      BAR,
      BAR,
      PPQ,
      't',
      'v'
    );
    expect(covers(out, BAR, BAR)).toBe(true);
  });

  it('splits a gap that is not one renderable duration', () => {
    // 5 sixteenths: not a single drawable value, so it must come out as several.
    const gap = (PPQ / 4) * 5;
    const out = fillVoiceWithRests(
      [note(gap, BAR - gap)],
      0,
      BAR,
      PPQ,
      't',
      'v'
    );
    expect(covers(out, 0, BAR)).toBe(true);
    expect(out.filter(e => !isNoteEvent(e)).length).toBeGreaterThan(1);
  });

  it('gives every event the voice and track it was told', () => {
    const out = fillVoiceWithRests(
      [note(PPQ, PPQ)],
      0,
      BAR,
      PPQ,
      'track-x',
      'voice-y'
    );
    for (const e of out) {
      expect(e.trackId).toBe('track-x');
      expect(e.voiceId).toBe('voice-y');
    }
  });
});
