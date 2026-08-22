/**
 * The clef in force at a bar. Every consumer — renderer, hit test, exporter —
 * reads it through here, so these pin the rule they all share.
 */
import { describe, expect, it } from 'vitest';
import type { Clef, Measure, Track } from '@sudobility/music_types';
import {
  clefAtMeasure,
  clefChangesAt,
  effectiveClef,
} from './effective-clef.js';

function track(
  clefs: Array<Clef | undefined>,
  trackClef: Clef = 'treble'
): Track {
  return {
    id: 't1',
    name: 'Piano',
    instrumentName: 'Piano',
    midiProgram: 0,
    midiChannel: 0,
    clef: trackClef,
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
    measures: clefs.map(
      (clef, index) =>
        ({
          id: `m${index}`,
          index,
          startTick: index * 1920,
          durationTicks: 1920,
          timeSignature: { numerator: 4, denominator: 4 },
          keySignature: { fifths: 0, mode: 'major' },
          voices: [],
          ...(clef ? { clef } : {}),
        }) as Measure
    ),
  };
}

describe('effectiveClef', () => {
  it('answers the track clef when no bar changes it', () => {
    // The common case, and the one that must behave exactly as it did before
    // per-measure clefs existed.
    const t = track([undefined, undefined, undefined], 'bass');
    expect([0, 1, 2].map(i => effectiveClef(t, i))).toEqual([
      'bass',
      'bass',
      'bass',
    ]);
  });

  it('carries a change forward to the bars after it', () => {
    const t = track([undefined, 'bass', undefined, undefined]);
    expect([0, 1, 2, 3].map(i => effectiveClef(t, i))).toEqual([
      'treble',
      'bass',
      'bass',
      'bass',
    ]);
  });

  it('takes the most recent change, not the first', () => {
    const t = track([undefined, 'bass', undefined, 'treble', undefined]);
    expect([1, 2, 3, 4].map(i => effectiveClef(t, i))).toEqual([
      'bass',
      'bass',
      'treble',
      'treble',
    ]);
  });

  it('answers the track clef for an index past the end', () => {
    // A caret past the last barline and an empty score both land here.
    expect(effectiveClef(track([]), 0)).toBe('treble');
    expect(effectiveClef(track([undefined]), 99)).toBe('treble');
  });

  it('clefAtMeasure works on a bare measure list', () => {
    const t = track([undefined, 'alto', undefined]);
    expect(clefAtMeasure(t.measures, 2, 'treble')).toBe('alto');
  });
});

describe('clefChangesAt', () => {
  it('is true only on the bar where the clef actually changes', () => {
    const t = track([undefined, 'bass', undefined, 'treble']);
    expect([0, 1, 2, 3].map(i => clefChangesAt(t, i))).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it('is false at bar 0, where the clef is established rather than changed', () => {
    // The system header draws it there; a "change" against nothing would
    // print a second clef immediately after the first.
    expect(clefChangesAt(track(['bass'], 'treble'), 0)).toBe(false);
  });

  it('is false for a marking equal to the clef already in force', () => {
    // An import can produce a redundant <clef>; drawing it would print a
    // change the reader cannot see the point of.
    expect(clefChangesAt(track([undefined, 'treble']), 1)).toBe(false);
  });

  it('is false outside the measure range', () => {
    expect(clefChangesAt(track([undefined, 'bass']), 5)).toBe(false);
  });
});
