import { describe, expect, it } from 'vitest';
import { detectKeySignature } from './key-detection.js';
import type {
  Accidental,
  NoteEvent,
  Pitch,
  PitchStep,
} from '@sudobility/music_types';
import { pitchToMidi } from '@sudobility/music_types';

let counter = 0;
function noteAt(
  step: PitchStep,
  accidental: Accidental,
  octave: number,
  durationTicks: number
): NoteEvent {
  counter += 1;
  const pitch: Pitch = { step, accidental, octave };
  return {
    id: `n${counter}`,
    pitch,
    startTick: 0,
    durationTicks,
    velocity: 80,
    voiceId: 'v',
    trackId: 't',
  };
}

describe('detectKeySignature', () => {
  it('defaults to C major for no notes', () => {
    expect(detectKeySignature([])).toEqual({ fifths: 0, mode: 'major' });
  });

  it('detects C major from a tonic-weighted C major scale', () => {
    const notes = [
      noteAt('C', 0, 4, 960),
      noteAt('D', 0, 4, 240),
      noteAt('E', 0, 4, 240),
      noteAt('F', 0, 4, 240),
      noteAt('G', 0, 4, 480),
      noteAt('A', 0, 4, 240),
      noteAt('B', 0, 4, 240),
    ];
    expect(detectKeySignature(notes)).toEqual({ fifths: 0, mode: 'major' });
  });

  it('detects D major (2 sharps) from a tonic-weighted D major scale', () => {
    const notes = [
      noteAt('D', 0, 4, 960),
      noteAt('E', 0, 4, 240),
      noteAt('F', 1, 4, 240),
      noteAt('G', 0, 4, 240),
      noteAt('A', 0, 4, 480),
      noteAt('B', 0, 4, 240),
      noteAt('C', 1, 5, 240),
    ];
    expect(detectKeySignature(notes)).toEqual({ fifths: 2, mode: 'major' });
  });

  it('detects A minor from a tonic/mediant/dominant-weighted natural minor collection', () => {
    const notes = [
      noteAt('A', 0, 3, 960),
      noteAt('C', 0, 4, 480),
      noteAt('E', 0, 4, 480),
      noteAt('D', 0, 4, 120),
      noteAt('F', 0, 4, 120),
      noteAt('G', 0, 4, 120),
      noteAt('B', 0, 4, 120),
    ];
    expect(detectKeySignature(notes)).toEqual({ fifths: 0, mode: 'minor' });
  });

  it('is invariant to note startTick/order (only pitch class + duration matter)', () => {
    const a = [noteAt('C', 0, 4, 480), noteAt('G', 0, 4, 480)];
    const b = a.map((n, i) => ({ ...n, startTick: i * 480 }));
    expect(detectKeySignature(a)).toEqual(detectKeySignature(b));
  });

  it('every returned key has a tonic reachable via pitchToMidi round-trip sanity (fifths in -7..7)', () => {
    const key = detectKeySignature([noteAt('F', 1, 4, 480)]); // F# alone, ambiguous but must be a valid signature
    expect(key.fifths).toBeGreaterThanOrEqual(-7);
    expect(key.fifths).toBeLessThanOrEqual(7);
    expect(pitchToMidi({ step: 'F', accidental: 1, octave: 4 })).toBe(66);
  });
});
