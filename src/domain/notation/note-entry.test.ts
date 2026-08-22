import {
  createAppStore,
  pitchToMidi,
  testStoreContext,
  twinkleScore,
} from '../../index.js';
import { describe, expect, it } from 'vitest';
import {
  durationForDigit,
  entryReferencePitch,
  isPitchLetter,
  nearestOctaveFor,
  pitchForLetter,
} from './note-entry.js';

function makeStore(): ReturnType<typeof createAppStore> {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twinkleScore());
  return store as unknown as ReturnType<typeof createAppStore>;
}

describe('isPitchLetter', () => {
  it('accepts A through G in either case, and nothing else', () => {
    for (const key of ['a', 'g', 'C', 'F'])
      expect(isPitchLetter(key)).toBe(true);
    for (const key of ['h', 'z', '1', 'Escape', '.'])
      expect(isPitchLetter(key)).toBe(false);
  });
});

describe('nearestOctaveFor', () => {
  it('writes the C after a B a semitone up, not a seventh down', () => {
    // The whole point of the heuristic: without it, letter entry can only
    // write a scale starting on C4.
    const b4 = { step: 'B' as const, accidental: 0 as const, octave: 4 };
    expect(nearestOctaveFor('C', b4)).toBe(5);
  });

  it('writes the B before a C a semitone down', () => {
    const c5 = { step: 'C' as const, accidental: 0 as const, octave: 5 };
    expect(nearestOctaveFor('B', c5)).toBe(4);
  });

  it('goes whichever way is closer, which is not always up', () => {
    const c4 = { step: 'C' as const, accidental: 0 as const, octave: 4 };
    // E is a third above (4 semitones) and a sixth below (8) — above wins.
    expect(nearestOctaveFor('E', c4)).toBe(4);
    // G is a fifth above (7) and a fourth below (5) — below wins, which is
    // also what MuseScore does.
    expect(nearestOctaveFor('G', c4)).toBe(3);
  });

  it('never leaves the note more than a tritone away', () => {
    // The strongest statement of "nearest": whatever the pair, the chosen
    // octave puts it within six semitones.
    const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
    for (const reference of steps) {
      for (const step of steps) {
        const from = { step: reference, accidental: 0 as const, octave: 4 };
        const octave = nearestOctaveFor(step, from);
        const distance = Math.abs(
          pitchToMidi({ step, accidental: 0 as const, octave }) -
            pitchToMidi(from)
        );
        expect(distance).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('entryReferencePitch', () => {
  it('falls back to middle C with nothing written yet', () => {
    const store = createAppStore({
      context: testStoreContext(),
    }) as unknown as ReturnType<typeof createAppStore>;
    expect(entryReferencePitch(store)).toEqual({
      step: 'C',
      accidental: 0 as const,
      octave: 4,
    });
  });

  it('uses the last note before the caret, not the last note in the track', () => {
    // Entry runs left to right; the reference is what a player would have just
    // played, which is behind the caret rather than at the end of the bar.
    const store = makeStore();
    store.getState().setCaretTick(0);
    const atStart = entryReferencePitch(store);

    const score = store.getState().score!;
    const last = score.tracks[0].measures.at(-1)!;
    store.getState().setCaretTick(last.startTick + last.durationTicks - 1);
    const atEnd = entryReferencePitch(store);

    expect(atStart).toBeTruthy();
    expect(atEnd).toBeTruthy();
    // Twinkle does not end on the note it starts on.
    expect(pitchToMidi(atEnd)).not.toBe(pitchToMidi(atStart));
  });
});

describe('pitchForLetter', () => {
  it('turns a keystroke into a natural of that step', () => {
    const store = makeStore();
    const pitch = pitchForLetter(store, 'f');
    expect(pitch.step).toBe('F');
    expect(pitch.accidental).toBe(0);
  });
});

describe('durationForDigit', () => {
  it('maps the digits every notation editor uses', () => {
    expect(durationForDigit('1', 'quarter')).toBe('whole');
    expect(durationForDigit('3', 'whole')).toBe('quarter');
    expect(durationForDigit('5', 'quarter')).toBe('sixteenth');
  });

  it('keeps the dot or triplet already chosen', () => {
    // The modifier is a mode, exactly as it is on the toolbar: pressing 3 with
    // Dotted lit gives a dotted quarter.
    expect(durationForDigit('3', 'dotted-eighth')).toBe('dotted-quarter');
    expect(durationForDigit('2', 'triplet-quarter')).toBe('triplet-half');
  });

  it('ignores a digit that names no note value', () => {
    expect(durationForDigit('9', 'quarter')).toBeNull();
    expect(durationForDigit('0', 'quarter')).toBeNull();
  });
});
