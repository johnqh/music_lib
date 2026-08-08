import { describe, expect, it } from 'vitest';
import { defaultMidiImportOptions } from './import-options.js';
import type { MidiSummary, MidiTrackSummary } from './analyze.js';

function track(overrides: Partial<MidiTrackSummary>): MidiTrackSummary {
  return {
    index: 0,
    name: 'Track',
    channel: 0,
    program: 0,
    instrumentName: 'Piano',
    noteCount: 1,
    durationSeconds: 1,
    isPercussion: false,
    averageMidi: 64,
    ...overrides,
  };
}

function summary(
  tracks: MidiTrackSummary[],
  detectedGrid: MidiSummary['detectedGrid'] = { grid: 'sixteenth', triplet: false },
): MidiSummary {
  return { ppq: 480, durationSeconds: 4, tracks, tempoEvents: [{ tick: 0, bpm: 120 }], timeSignatures: [], detectedGrid };
}

describe('defaultMidiImportOptions', () => {
  it('includes every non-empty track and excludes note-free tracks', () => {
    const options = defaultMidiImportOptions(
      summary([track({ index: 0, noteCount: 4 }), track({ index: 1, noteCount: 0, averageMidi: null })]),
    );
    expect(options.trackSelections).toEqual([
      { sourceIndex: 0, include: true, clef: 'treble', name: 'Track' },
      { sourceIndex: 1, include: false, clef: 'treble', name: 'Track' },
    ]);
  });

  it('defaults percussion tracks to the percussion clef', () => {
    const options = defaultMidiImportOptions(summary([track({ isPercussion: true, channel: 9 })]));
    expect(options.trackSelections[0].clef).toBe('percussion');
  });

  it('defaults clef by note centroid: >= middle C is treble, below is bass', () => {
    const options = defaultMidiImportOptions(
      summary([track({ index: 0, averageMidi: 60 }), track({ index: 1, averageMidi: 59 })]),
    );
    expect(options.trackSelections[0].clef).toBe('treble');
    expect(options.trackSelections[1].clef).toBe('bass');
  });

  it('sets sensible non-track-selection defaults', () => {
    const options = defaultMidiImportOptions(summary([track({})]));
    expect(options.quantizeGrid).toBe('sixteenth');
    expect(options.tripletDetection).toBe(false);
    expect(options.minDurationTicks).toBeGreaterThan(0);
    expect(options.mergeNearDuplicates).toBe(false);
    expect(options.sustainPedal).toBe('extend');
    expect(options.pianoStaffSplit).toBe(false);
    expect(options.splitPointMidi).toBe(60);
    expect(options.detectKey).toBe(true);
  });
});

describe('quantization defaults follow the file', () => {
  it('opens the wizard on the grid the file was detected to be written on', () => {
    // Not a fixed sixteenth: a triplet file quantized to sixteenths comes back
    // audibly wrong. See grid-detection.ts.
    const options = defaultMidiImportOptions(
      summary([track({ index: 0, noteCount: 4 })], { grid: 'eighth', triplet: true }),
    );
    expect(options.quantizeGrid).toBe('eighth');
    expect(options.tripletDetection).toBe(true);
  });
});
