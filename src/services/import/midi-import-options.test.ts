import { describe, expect, it } from 'vitest';
import type { MidiImportOptions } from '@sudobility/music_codecs';
import { parseNumericDraft } from '@sudobility/music_types';
import {
  canImportMidi,
  patchMidiImportOptions,
} from './midi-import-options.js';

function options(): MidiImportOptions {
  return {
    trackSelections: [
      { sourceIndex: 0, include: true, clef: 'treble', name: 'Right' },
      { sourceIndex: 3, include: true, clef: 'bass', name: 'Left' },
    ],
    quantizeGrid: 'sixteenth',
    tripletDetection: false,
    minDurationTicks: 1,
    mergeNearDuplicates: false,
    sustainPedal: 'extend',
    pianoStaffSplit: true,
    splitPointMidi: 60,
    detectKey: true,
  };
}

describe('patchMidiImportOptions', () => {
  it('merges plain fields and returns a new object', () => {
    const before = options();
    const after = patchMidiImportOptions(before, {
      quantizeGrid: null,
      detectKey: false,
      sustainPedal: 'ignore',
    });
    expect(after).not.toBe(before);
    expect(after).toMatchObject({
      quantizeGrid: null,
      detectKey: false,
      sustainPedal: 'ignore',
    });
    expect(before.detectKey).toBe(true);
  });

  it('patches one track by its source index, not its position', () => {
    const after = patchMidiImportOptions(options(), {
      track: { sourceIndex: 3, include: false, clef: 'treble' },
    });
    expect(after.trackSelections).toEqual([
      { sourceIndex: 0, include: true, clef: 'treble', name: 'Right' },
      { sourceIndex: 3, include: false, clef: 'treble', name: 'Left' },
    ]);
  });

  it('keeps a split point of 0, which is a real MIDI note', () => {
    expect(
      patchMidiImportOptions(options(), { splitPointMidi: 0 }).splitPointMidi
    ).toBe(0);
  });

  it('clamps the split point to MIDI 0-127 and rounds it', () => {
    expect(
      patchMidiImportOptions(options(), { splitPointMidi: 200 }).splitPointMidi
    ).toBe(127);
    expect(
      patchMidiImportOptions(options(), { splitPointMidi: -4 }).splitPointMidi
    ).toBe(0);
    expect(
      patchMidiImportOptions(options(), { splitPointMidi: 64.6 }).splitPointMidi
    ).toBe(65);
  });

  it('ignores a split point that is not a number, keeping the last one', () => {
    const before = { ...options(), splitPointMidi: 48 };
    expect(
      patchMidiImportOptions(before, { splitPointMidi: NaN }).splitPointMidi
    ).toBe(48);
  });

  it('keeps the split point when its field is cleared, as parseNumericDraft reports it', () => {
    // `Number('')` is 0: reading a cleared field that way moved the split to
    // the lowest MIDI note while somebody was typing a new one.
    const before = { ...options(), splitPointMidi: 48 };
    expect(
      patchMidiImportOptions(before, {
        splitPointMidi: parseNumericDraft('', { integer: true }),
      }).splitPointMidi
    ).toBe(48);
  });

  it('floors the minimum duration at zero, and reads a blank field as zero', () => {
    expect(
      patchMidiImportOptions(options(), { minDurationTicks: -10 })
        .minDurationTicks
    ).toBe(0);
    expect(
      patchMidiImportOptions(options(), { minDurationTicks: NaN })
        .minDurationTicks
    ).toBe(0);
    expect(
      patchMidiImportOptions(options(), { minDurationTicks: null })
        .minDurationTicks
    ).toBe(0);
    expect(
      patchMidiImportOptions(options(), { minDurationTicks: 120.4 })
        .minDurationTicks
    ).toBe(120);
  });
});

describe('canImportMidi', () => {
  it('needs at least one included track', () => {
    expect(canImportMidi(options())).toBe(true);
    const none = patchMidiImportOptions(
      patchMidiImportOptions(options(), {
        track: { sourceIndex: 0, include: false },
      }),
      { track: { sourceIndex: 3, include: false } }
    );
    expect(canImportMidi(none)).toBe(false);
  });

  it('is false before a file has been read', () => {
    expect(canImportMidi(null)).toBe(false);
  });
});
