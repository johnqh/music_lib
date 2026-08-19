import { describe, expect, it } from 'vitest';
import { collapseRests, isSilentMeasure } from './collapse-rests.js';
import type {
  KeySignature,
  Measure,
  TimeSignature,
} from '@sudobility/music_types';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };
const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };

let nextId = 0;
/** A measure holding one whole-bar rest, or one note when `withNote`. */
function measure(
  index: number,
  withNote = false,
  overrides: Partial<Measure> = {}
): Measure {
  nextId += 1;
  const voiceId = `v${nextId}`;
  return {
    id: `m${nextId}`,
    index,
    startTick: index * 1920,
    durationTicks: 1920,
    timeSignature: FOUR_FOUR,
    keySignature: C_MAJOR,
    voices: [
      {
        id: voiceId,
        name: 'Voice 1',
        events: withNote
          ? [
              {
                id: `n${nextId}`,
                pitch: { step: 'C', accidental: 0, octave: 4 },
                startTick: index * 1920,
                durationTicks: 1920,
                velocity: 80,
                voiceId,
                trackId: 't1',
              },
            ]
          : [
              {
                id: `r${nextId}`,
                startTick: index * 1920,
                durationTicks: 1920,
                voiceId,
                trackId: 't1',
              },
            ],
      },
    ],
    ...overrides,
  } as Measure;
}

const counts = (ms: Measure[]) => ms.map(m => m.multiMeasureRestCount ?? 1);
const indices = (ms: Measure[]) => ms.map(m => m.index);

describe('isSilentMeasure', () => {
  it('is true for a measure of rests', () => {
    expect(isSilentMeasure(measure(0))).toBe(true);
  });

  it('is false when a voice holds a note', () => {
    expect(isSilentMeasure(measure(0, true))).toBe(false);
  });

  it('is false when a second voice holds a note', () => {
    // One note anywhere disqualifies the bar; a player still has to play it.
    const m = measure(0);
    const withSecond = {
      ...m,
      voices: [...m.voices, measure(0, true).voices[0]],
    };
    expect(isSilentMeasure(withSecond)).toBe(false);
  });

  it('is true for a measure with no voices at all', () => {
    expect(isSilentMeasure({ ...measure(0), voices: [] })).toBe(true);
  });
});

describe('collapseRests', () => {
  it('collapses a run of silent measures into one carrying the count', () => {
    const result = collapseRests([
      measure(0),
      measure(1),
      measure(2),
      measure(3, true),
    ]);
    expect(result).toHaveLength(2);
    expect(counts(result)).toEqual([3, 1]);
  });

  it('leaves a single silent measure alone', () => {
    // "1" over a bar is noise; every engraver writes it out.
    const result = collapseRests([
      measure(0, true),
      measure(1),
      measure(2, true),
    ]);
    expect(result).toHaveLength(3);
    expect(result[1].multiMeasureRestCount).toBeUndefined();
  });

  it('keeps the original index of the measure it starts at', () => {
    // This is what makes bar 25 follow a 24-bar rest. The renderer draws
    // numbers from measure.index, so preserving it is the whole feature.
    const measures = [
      measure(0, true),
      ...Array.from({ length: 24 }, (_, i) => measure(i + 1)),
      measure(25, true),
    ];
    const result = collapseRests(measures);
    expect(indices(result)).toEqual([0, 1, 25]);
    expect(result[1].multiMeasureRestCount).toBe(24);
  });

  it('collapses a run at the very start', () => {
    const result = collapseRests([measure(0), measure(1), measure(2, true)]);
    expect(counts(result)).toEqual([2, 1]);
    expect(indices(result)).toEqual([0, 2]);
  });

  it('collapses a run at the very end', () => {
    const result = collapseRests([measure(0, true), measure(1), measure(2)]);
    expect(counts(result)).toEqual([1, 2]);
  });

  it('collapses a piece that is entirely silent', () => {
    expect(counts(collapseRests([measure(0), measure(1), measure(2)]))).toEqual(
      [3]
    );
  });

  it('breaks a run at a time-signature change', () => {
    // The rest asserts the bars inside it are alike; spanning 4/4 to 3/4 would
    // hide where the change happened.
    const threeFour: TimeSignature = { numerator: 3, denominator: 4 };
    const result = collapseRests([
      measure(0),
      measure(1),
      measure(2, false, { timeSignature: threeFour }),
      measure(3, false, { timeSignature: threeFour }),
    ]);
    expect(counts(result)).toEqual([2, 2]);
  });

  it('breaks a run at a key change', () => {
    const dMajor: KeySignature = { fifths: 2, mode: 'major' };
    const result = collapseRests([
      measure(0),
      measure(1),
      measure(2, false, { keySignature: dMajor }),
      measure(3, false, { keySignature: dMajor }),
    ]);
    expect(counts(result)).toEqual([2, 2]);
  });

  it('leaves a score with no silence untouched', () => {
    const measures = [measure(0, true), measure(1, true)];
    expect(collapseRests(measures)).toEqual(measures);
  });

  it('does not mutate the measures it was given', () => {
    const measures = [measure(0), measure(1), measure(2, true)];
    const before = JSON.stringify(measures);
    collapseRests(measures);
    expect(JSON.stringify(measures)).toBe(before);
  });

  it('breaks a run at a marked bar', () => {
    // A mark inside a multi-measure rest would be invisible, and the
    // conductor's "from B" would point at nothing.
    const result = collapseRests([
      measure(0),
      measure(1),
      measure(2, false, { rehearsalMark: 'B' }),
      measure(3),
    ]);
    expect(counts(result)).toEqual([2, 2]);
    expect(result[1].rehearsalMark).toBe('B');
  });

  it('breaks a run before a cue bar, and writes the cue bar out', () => {
    // The cue bar is silent in the player's own voices, so without this it
    // would vanish into the very count it exists to end.
    const cue = { label: 'Flute', events: [] };
    const result = collapseRests([
      measure(0),
      measure(1),
      measure(2, false, { cue }),
      measure(3, true),
    ]);
    expect(counts(result)).toEqual([2, 1, 1]);
    expect(result[1].cue?.label).toBe('Flute');
    expect(result[1].multiMeasureRestCount).toBeUndefined();
  });

  it('does not let a cue bar start a run either', () => {
    const cue = { label: 'Flute', events: [] };
    const result = collapseRests([
      measure(0, true),
      measure(1, false, { cue }),
      measure(2),
      measure(3),
    ]);
    expect(result[1].multiMeasureRestCount).toBeUndefined();
    expect(counts(result)).toEqual([1, 1, 2]);
  });

  it('keeps a mark on a bar that starts a run', () => {
    const result = collapseRests([
      measure(0, true),
      measure(1, false, { rehearsalMark: 'B' }),
      measure(2),
      measure(3),
    ]);
    expect(result[1].rehearsalMark).toBe('B');
    expect(result[1].multiMeasureRestCount).toBe(3);
  });
});
