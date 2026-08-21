import { describe, expect, it } from 'vitest';
import { twinkleScore } from '../../test/fixtures.js';
import {
  accidentalCountLabel,
  barBeatForTick,
  durationLabel,
  keySignatureName,
  keySignatureOptions,
  pitchAtStavePosition,
  tickForBarBeat,
} from './music-vocabulary.js';

describe('durationLabel', () => {
  it('names every duration, dots and triplets included', () => {
    expect(durationLabel('quarter')).toBe('Quarter');
    expect(durationLabel('dotted-eighth')).toBe('Dotted eighth');
    expect(durationLabel('triplet-quarter')).toBe('Quarter triplet');
  });
});

describe('keySignatureName', () => {
  it('names the major keys by their tonic, not their fifths', () => {
    expect(keySignatureName({ fifths: 0, mode: 'major' })).toBe('C major');
    expect(keySignatureName({ fifths: 2, mode: 'major' })).toBe('D major');
    expect(keySignatureName({ fifths: -3, mode: 'major' })).toBe('E♭ major');
  });

  it('names the minor keys from the relative-minor table', () => {
    // Two sharps is D major *or* B minor; the mode picks the table.
    expect(keySignatureName({ fifths: 2, mode: 'minor' })).toBe('B minor');
    expect(keySignatureName({ fifths: 0, mode: 'minor' })).toBe('A minor');
  });

  it('falls back rather than inventing a name beyond seven accidentals', () => {
    expect(keySignatureName({ fifths: 9, mode: 'major' })).toBe('9 fifths');
  });
});

describe('accidentalCountLabel', () => {
  it('counts sharps and flats, and singularises one of them', () => {
    expect(accidentalCountLabel(0)).toBe('no sharps or flats');
    expect(accidentalCountLabel(1)).toBe('1 sharp');
    expect(accidentalCountLabel(3)).toBe('3 sharps');
    expect(accidentalCountLabel(-1)).toBe('1 flat');
    expect(accidentalCountLabel(-4)).toBe('4 flats');
  });
});

describe('keySignatureOptions', () => {
  it('offers fifteen keys, flats through sharps, in that order', () => {
    const options = keySignatureOptions('major');
    expect(options).toHaveLength(15);
    expect(options[0].fifths).toBe(-7);
    expect(options[14].fifths).toBe(7);
    expect(options.find(o => o.fifths === 2)?.label).toBe('D major — 2 sharps');
  });
});

describe('barBeatForTick / tickForBarBeat', () => {
  it('counts bars and beats from one, the way a player does', () => {
    const score = twinkleScore();
    expect(barBeatForTick(score, 0)).toEqual({ bar: 1, beat: 1 });
  });

  it('reports a position between beats as a fraction', () => {
    const score = twinkleScore();
    // Half a quarter-note beat into the first bar.
    expect(barBeatForTick(score, score.ppq / 2)).toEqual({ bar: 1, beat: 1.5 });
  });

  it('round-trips a tick through bar/beat and back', () => {
    const score = twinkleScore();
    const tick = score.ppq * 5; // somewhere in bar 2
    const bb = barBeatForTick(score, tick)!;
    expect(tickForBarBeat(score, bb.bar, bb.beat)).toBe(tick);
  });

  it('clamps a beat past the end of its bar rather than failing', () => {
    // "Beat 9" in 4/4 is a typo for the end of the bar, not an error.
    const score = twinkleScore();
    const measure = score.tracks[0].measures[0];
    const tick = tickForBarBeat(score, 1, 9)!;
    expect(tick).toBeLessThan(measure.startTick + measure.durationTicks);
    expect(tick).toBeGreaterThan(measure.startTick);
  });

  it('answers null past the end of the score', () => {
    const score = twinkleScore();
    const last = score.tracks[0].measures.at(-1)!;
    expect(
      barBeatForTick(score, last.startTick + last.durationTicks)
    ).toBeNull();
    expect(tickForBarBeat(score, 999, 1)).toBeNull();
  });
});

describe('pitchAtStavePosition', () => {
  it('puts the treble clef’s landmark notes on their lines', () => {
    // Top line F5, then E5 in the space below, D5 on the next line down.
    expect(pitchAtStavePosition('treble', 0)).toEqual({
      step: 'F',
      accidental: 0,
      octave: 5,
    });
    expect(pitchAtStavePosition('treble', 1)).toEqual({
      step: 'E',
      accidental: 0,
      octave: 5,
    });
    expect(pitchAtStavePosition('treble', 2)).toEqual({
      step: 'D',
      accidental: 0,
      octave: 5,
    });
    // Middle C sits one ledger line below the treble stave: ten positions down.
    expect(pitchAtStavePosition('treble', 10)).toEqual({
      step: 'C',
      accidental: 0,
      octave: 4,
    });
  });

  it('puts the bass clef’s landmark notes on their lines', () => {
    expect(pitchAtStavePosition('bass', 0)).toEqual({
      step: 'A',
      accidental: 0,
      octave: 3,
    });
    // Middle C is one ledger line *above* the bass stave: two positions up.
    expect(pitchAtStavePosition('bass', -2)).toEqual({
      step: 'C',
      accidental: 0,
      octave: 4,
    });
  });

  it('reads ledger positions above the stave', () => {
    expect(pitchAtStavePosition('treble', -1)).toEqual({
      step: 'G',
      accidental: 0,
      octave: 5,
    });
  });

  it('names a letter, never an accidental — the key signature decides that', () => {
    for (let position = -6; position <= 16; position++) {
      expect(pitchAtStavePosition('alto', position).accidental).toBe(0);
    }
  });
});
