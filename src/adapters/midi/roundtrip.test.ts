/**
 * Round-trip test (Task 7 brief): fixture score -> exportMidi -> importMidi
 * (quantized to sixteenth notes) -> note pitches/starts/durations should be
 * exactly equal for these already-sixteenth-note-aligned fixtures, and
 * tempo/time signatures must be preserved.
 */
import { describe, expect, it } from 'vitest';
import { exportMidi } from './export.js';
import { importMidi } from './import.js';
import { analyzeMidi } from './analyze.js';
import { defaultMidiImportOptions } from './import-options.js';
import { allNotes } from '../../domain/score/queries.js';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import { validateScore } from '../../domain/validation/validator.js';
import type { Score } from '@sudobility/music_types';
import {
  chordScore,
  stressScore,
  twinkleScore,
  twoTrackScore,
} from '../../test/fixtures.js';
import { createMusicIo } from '@sudobility/music_io/mocks';

// The real codec, via the mocks entry: MIDI encoding is pure byte manipulation,
// and the mocks entry -- unlike music_io/web -- does not import music_lib.
const codec = createMusicIo().midiCodec;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer as ArrayBuffer;
}

/** Exports `source`, then re-imports it quantized to the nearest sixteenth note. */
function roundTrip(source: Score): { imported: Score; warnings: string[] } {
  const buffer = toArrayBuffer(exportMidi(source, codec));
  const summary = analyzeMidi(buffer, codec);
  const options = {
    ...defaultMidiImportOptions(summary),
    quantizeGrid: 'sixteenth' as const,
    detectKey: false,
  };
  const { score, warnings } = importMidi(buffer, options, codec);
  return { imported: score, warnings };
}

describe.each([
  ['twinkleScore', twinkleScore],
  ['twoTrackScore', twoTrackScore],
  ['chordScore', chordScore],
  ['stressScore (3x4)', () => stressScore(3, 4)],
])('MIDI round trip: %s', (_name, factory) => {
  it('preserves tempo and time signatures', () => {
    const source = factory();
    const { imported } = roundTrip(source);

    expect(imported.tempoMap).toHaveLength(source.tempoMap.length);
    source.tempoMap.forEach((tempo, i) => {
      expect(imported.tempoMap[i].tick).toBe(tempo.tick);
      expect(imported.tempoMap[i].bpm).toBeCloseTo(tempo.bpm, 1);
    });

    const sourceTimeSignatures =
      source.tracks[0]?.measures.map(m => m.timeSignature) ?? [];
    const importedTimeSignatures =
      imported.tracks[0]?.measures.map(m => m.timeSignature) ?? [];
    expect(importedTimeSignatures).toEqual(sourceTimeSignatures);
  });

  it('reproduces note pitches, starts, and durations exactly (fixtures are already sixteenth-note-aligned)', () => {
    const source = factory();
    const { imported } = roundTrip(source);

    const sourceNotes = allNotes(source).sort(
      (a, b) =>
        a.startTick - b.startTick || pitchToMidi(a.pitch) - pitchToMidi(b.pitch)
    );
    const importedNotes = allNotes(imported).sort(
      (a, b) =>
        a.startTick - b.startTick || pitchToMidi(a.pitch) - pitchToMidi(b.pitch)
    );

    expect(importedNotes).toHaveLength(sourceNotes.length);
    for (let i = 0; i < sourceNotes.length; i += 1) {
      expect(importedNotes[i].startTick).toBe(sourceNotes[i].startTick);
      expect(importedNotes[i].durationTicks).toBe(sourceNotes[i].durationTicks);
      expect(pitchToMidi(importedNotes[i].pitch)).toBe(
        pitchToMidi(sourceNotes[i].pitch)
      );
    }
  });

  it('produces a score with zero validateScore errors', () => {
    const { imported } = roundTrip(factory());
    const errors = validateScore(imported).filter(
      issue => issue.severity === 'error'
    );
    expect(errors).toEqual([]);
  });

  it('carries the mandatory "not full notation" warning', () => {
    const { warnings } = roundTrip(factory());
    expect(warnings.some(w => /performance timing|approximates/i.test(w))).toBe(
      true
    );
  });
});
