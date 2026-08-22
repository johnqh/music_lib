/**
 * D.C., D.S., Fine and the coda — the order a player actually performs.
 *
 * The rule that is easy to get wrong and impossible to see in the notation:
 * `Fine` and `To Coda` mean **nothing on the way out**. A player reads
 * straight past both until a jump has sent them back; only then do they end
 * the piece or leave for the coda. Getting that backwards stops the piece at
 * the Fine the first time it is met, which is roughly half the score.
 */
import { describe, expect, it } from 'vitest';
import type { Measure, Score } from '@sudobility/music_types';
import { repeatPlayOrder } from './repeat-order.js';

/** A score of `n` bars, with per-bar marks applied by index. */
function score(n: number, marks: Record<number, Partial<Measure>> = {}): Score {
  const measures = Array.from({ length: n }, (_, index) => ({
    id: `m${index}`,
    index,
    startTick: index * 1920,
    durationTicks: 1920,
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: { fifths: 0, mode: 'major' },
    voices: [],
    ...(marks[index] ?? {}),
  })) as Measure[];

  return {
    id: 's',
    version: 1,
    ppq: 480,
    metadata: {
      title: 'Nav',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    tempoMap: [{ id: 't', tick: 0, bpm: 120 }],
    tracks: [
      {
        id: 't1',
        name: 'P',
        instrumentName: 'Piano',
        midiProgram: 0,
        midiChannel: 0,
        clef: 'treble',
        volume: 1,
        pan: 0,
        muted: false,
        solo: false,
        measures,
      },
    ],
  };
}

const played = (s: Score) => repeatPlayOrder(s).map(p => p.measureIndex);

describe('da capo', () => {
  it('goes back to the start and plays to the end', () => {
    expect(played(score(3, { 2: { jump: 'da-capo' } }))).toEqual([
      0, 1, 2, 0, 1, 2,
    ]);
  });

  it('is obeyed once, so the piece finishes', () => {
    // Without a "taken" guard a D.C. loops forever.
    const order = played(score(3, { 2: { jump: 'da-capo' } }));
    expect(order.filter(i => i === 2)).toHaveLength(2);
  });
});

describe('da capo al fine', () => {
  it('reads past the Fine on the way out, and stops at it on the way back', () => {
    // Bars 0,1,2,3 then back to 0,1 and stop — Fine is on bar 1.
    expect(
      played(score(4, { 1: { fine: true }, 3: { jump: 'da-capo-al-fine' } }))
    ).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('plays to the end when the score names no Fine', () => {
    // A broken score still plays, rather than refusing.
    expect(played(score(3, { 2: { jump: 'da-capo-al-fine' } }))).toEqual([
      0, 1, 2, 0, 1, 2,
    ]);
  });
});

describe('dal segno', () => {
  it('returns to the sign, not to the start', () => {
    expect(
      played(score(4, { 1: { segno: true }, 3: { jump: 'dal-segno' } }))
    ).toEqual([0, 1, 2, 3, 1, 2, 3]);
  });

  it('falls back to the start when the score has no segno', () => {
    expect(played(score(3, { 2: { jump: 'dal-segno' } }))).toEqual([
      0, 1, 2, 0, 1, 2,
    ]);
  });
});

describe('al coda', () => {
  it('leaves at To Coda on the way back and resumes at the coda', () => {
    // 0..4 out; back to segno (1); 1,2 then leave at To Coda (2) for the
    // coda (4).
    const order = played(
      score(5, {
        1: { segno: true },
        2: { toCoda: true },
        3: { jump: 'dal-segno-al-coda' },
        4: { coda: true },
      })
    );
    expect(order).toEqual([0, 1, 2, 3, 1, 2, 4]);
  });

  it('reads past To Coda on the way out', () => {
    // Bar 2 carries To Coda and is played normally the first time through.
    const order = played(
      score(5, {
        1: { segno: true },
        2: { toCoda: true },
        3: { jump: 'dal-segno-al-coda' },
        4: { coda: true },
      })
    );
    expect(order.slice(0, 4)).toEqual([0, 1, 2, 3]);
  });

  it('plays to the end when the coda marks are incomplete', () => {
    const order = played(
      score(4, { 1: { segno: true }, 3: { jump: 'dal-segno-al-coda' } })
    );
    expect(order).toEqual([0, 1, 2, 3, 1, 2, 3]);
  });
});

describe('interaction with repeats', () => {
  it('takes a repeat before the jump that follows it', () => {
    const order = played(
      score(4, { 1: { repeatEnd: true }, 3: { jump: 'da-capo' } })
    );
    // 0,1 then the repeat back to 0,1, then on to 2,3 and the D.C.
    expect(order.slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(order.filter(i => i === 3)).toHaveLength(2);
  });

  it('leaves a score with no navigation marks completely unchanged', () => {
    expect(played(score(4))).toEqual([0, 1, 2, 3]);
  });
});
