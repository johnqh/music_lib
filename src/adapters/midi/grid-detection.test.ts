import { describe, expect, it } from 'vitest';
import { detectGrid, FALLBACK_GRID } from './grid-detection.js';

const PPQ = 480;

/** Onsets for `beats` expressed in quarter notes, at `PPQ`. */
function ticks(beats: number[]): number[] {
  return beats.map(b => Math.round(b * PPQ));
}

describe('detectGrid', () => {
  it('describes straight eighths as eighths, not as a finer grid that also contains them', () => {
    expect(detectGrid(ticks([0, 0.5, 1, 1.5, 2, 2.5]), PPQ)).toEqual({
      grid: 'eighth',
      triplet: false,
    });
  });

  it('detects eighth-note triplets — the case a fixed sixteenth grid bent out of shape', () => {
    const beats = [0, 1 / 3, 2 / 3, 1, 4 / 3, 5 / 3, 2, 7 / 3, 8 / 3];
    expect(detectGrid(ticks(beats), PPQ)).toEqual({
      grid: 'eighth',
      triplet: true,
    });
  });

  it('detects swung eighths, which ride the same triplet grid', () => {
    const beats = [0, 2 / 3, 1, 5 / 3, 2, 8 / 3, 3, 11 / 3];
    expect(detectGrid(ticks(beats), PPQ)).toEqual({
      grid: 'eighth',
      triplet: true,
    });
  });

  it('falls to the 1/12-beat grid when a file uses sixteenths and triplets together', () => {
    const beats = [0, 0.25, 0.5, 0.75, 1, 4 / 3, 5 / 3, 2];
    expect(detectGrid(ticks(beats), PPQ)).toEqual({
      grid: 'thirtysecond',
      triplet: true,
    });
  });

  it('is unmoved by the tick-level rounding a sequencer leaves behind', () => {
    // Eighths, each a tick or two off — still eighths.
    expect(detectGrid([0, 239, 481, 719, 960, 1202], PPQ)).toEqual({
      grid: 'eighth',
      triplet: false,
    });
  });

  it('tolerates a stray grace note rather than letting one note pick the grid', () => {
    // The allowance is proportional, so this needs a realistically sized file:
    // one nudged note among a hundred, not among twenty.
    const eighths = ticks(Array.from({ length: 100 }, (_, i) => i * 0.5));
    expect(detectGrid([...eighths, Math.round(1.97 * PPQ)], PPQ)).toEqual({
      grid: 'eighth',
      triplet: false,
    });
  });

  it('refuses a grid that a real minority of the notes are off — they would be snapped onto it', () => {
    // 92% eighths, 8% sixteenths. Calling this an eighth-note file would move
    // every sixteenth by an audible 62ms at 120bpm; the finer grid moves none.
    const eighths = Array.from({ length: 92 }, (_, i) => i * 0.5);
    const sixteenths = Array.from(
      { length: 8 },
      (_, i) => 100 + i * 0.5 + 0.25
    );
    expect(detectGrid(ticks([...eighths, ...sixteenths]), PPQ)).toEqual({
      grid: 'sixteenth',
      triplet: false,
    });
  });

  it('falls back to no grid for a played performance, preserving timing by default', () => {
    // Eighths pushed and dragged by 30-60ms at 120bpm — on no grid at all.
    const played = [0, 267, 494, 741, 941, 1207, 1445, 1668];
    expect(detectGrid(played, PPQ)).toEqual(FALLBACK_GRID);
  });

  it('is resolution-independent: the same music at 960 ppq detects the same', () => {
    const beats = [0, 1 / 3, 2 / 3, 1, 4 / 3, 5 / 3];
    const at960 = beats.map(b => Math.round(b * 960));
    expect(detectGrid(at960, 960)).toEqual({ grid: 'eighth', triplet: true });
  });

  it('falls back rather than dividing by zero on an empty or degenerate file', () => {
    expect(detectGrid([], PPQ)).toEqual(FALLBACK_GRID);
    expect(detectGrid([0, 240], 0)).toEqual(FALLBACK_GRID);
  });
});

describe('detectGrid accounts for note ends, not just onsets', () => {
  it('refuses a grid too coarse to hold the note durations', () => {
    // Staccato quarters: onsets on the quarter grid, ends on the eighth grid.
    // Choosing "quarter" here would stretch every note to fill the beat and
    // make the piece sound sluggish and slurred.
    const onsets = [0, 1, 2, 3, 4, 5, 6, 7];
    const ends = onsets.map(b => b + 0.5);
    const positions = [...onsets, ...ends].map(b => Math.round(b * PPQ));
    expect(detectGrid(positions, PPQ)).toEqual({
      grid: 'eighth',
      triplet: false,
    });
  });
});
