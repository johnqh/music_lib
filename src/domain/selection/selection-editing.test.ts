import { describe, expect, it } from 'vitest';
import { chordSelection } from './selection-editing.js';
import type { NoteEvent } from '@sudobility/music_types';

const note = (
  id: string,
  startTick: number,
  durationTicks = 480,
  trackId = 't1'
): NoteEvent =>
  ({
    id,
    startTick,
    durationTicks,
    trackId,
    voiceId: 'v1',
    pitch: { step: 'C', accidental: 0, octave: 4 },
    velocity: 80,
  }) as unknown as NoteEvent;

describe('chordSelection', () => {
  it('is null for an empty selection', () => {
    expect(chordSelection([])).toBeNull();
  });

  it('treats a single note as a chord of one', () => {
    const result = chordSelection([note('a', 0)]);
    expect(result?.notes).toHaveLength(1);
    expect(result?.startTick).toBe(0);
  });

  it('accepts notes that share a start tick', () => {
    const result = chordSelection([note('a', 0), note('b', 0), note('c', 0)]);
    expect(result?.notes).toHaveLength(3);
  });

  it('is null when the selection spans several ticks', () => {
    // Two chords have no single chord to edit, and guessing which one the
    // player meant would be worse than doing nothing.
    expect(chordSelection([note('a', 0), note('b', 480)])).toBeNull();
  });

  it('is null when the selection spans several tracks', () => {
    expect(
      chordSelection([note('a', 0, 480, 't1'), note('b', 0, 480, 't2')])
    ).toBeNull();
  });

  it('takes the duration from the notes', () => {
    expect(chordSelection([note('a', 0, 960)])?.durationTicks).toBe(960);
  });
});

describe('chordSelection is voice-aware', () => {
  const inVoice = (id: string, voiceId: string): NoteEvent =>
    ({
      id,
      startTick: 0,
      durationTicks: 480,
      trackId: 't1',
      voiceId,
      pitch: { step: 'C', accidental: 0, octave: 4 },
      velocity: 80,
    }) as unknown as NoteEvent;

  it('is null when notes at the same tick belong to different voices', () => {
    // Two voices on one stave sound together by design. Treating a melody note
    // and the bass under it as one chord would let a key press edit a line the
    // player was not looking at.
    expect(chordSelection([inVoice('a', 'v1'), inVoice('b', 'v2')])).toBeNull();
  });

  it('accepts notes sharing a tick within one voice', () => {
    expect(
      chordSelection([inVoice('a', 'v1'), inVoice('b', 'v1')])?.notes
    ).toHaveLength(2);
  });

  it('reports the voice it resolved', () => {
    expect(chordSelection([inVoice('a', 'v2')])?.voiceId).toBe('v2');
  });
});
