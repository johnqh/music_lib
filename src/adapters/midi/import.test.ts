import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { exportMidi } from './export.js';
import { importMidi } from './import.js';
import { defaultMidiImportOptions } from './import-options.js';
import { analyzeMidi } from './analyze.js';
import { validateScore } from '../../domain/validation/validator.js';
import { isNoteEvent } from '@sudobility/music_types';
import { allNotes } from '../../domain/score/queries.js';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import { chordScore, twinkleScore, twoTrackScore } from '../../test/fixtures.js';
import { createMusicIo } from '@sudobility/music_io/mocks';

// The real codec, via the mocks entry: MIDI encoding is pure byte manipulation,
// and the mocks entry -- unlike music_io/web -- does not import music_lib.
const codec = createMusicIo().midiCodec;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer as ArrayBuffer;
}

function importFixture(scoreFactory: () => ReturnType<typeof twinkleScore>, optionsOverride: Partial<ReturnType<typeof defaultMidiImportOptions>> = {}) {
  const score = scoreFactory();
  const bytes = exportMidi(score, codec);
  const buffer = toArrayBuffer(bytes);
  const summary = analyzeMidi(buffer, codec);
  const options = { ...defaultMidiImportOptions(summary), ...optionsOverride };
  return { source: score, ...importMidi(buffer, options, codec) };
}

describe('importMidi', () => {
  it('produces a valid score (zero validateScore errors) from a simple exported fixture', () => {
    const { score } = importFixture(twinkleScore);
    const errors = validateScore(score).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('imports PPQ as 480 and preserves tempo/title', () => {
    const { score } = importFixture(chordScore);
    expect(score.ppq).toBe(480);
    expect(score.tempoMap).toHaveLength(1);
    expect(score.tempoMap[0].bpm).toBeCloseTo(90, 1);
    expect(score.metadata.title).toBe('Chord Progression Demo');
  });

  it('imports one track per included selection, preserving name/program/channel', () => {
    const { score } = importFixture(twoTrackScore);
    expect(score.tracks).toHaveLength(2);
    expect(score.tracks[0].name).toBe('Treble');
    expect(score.tracks[0].midiChannel).toBe(0);
    expect(score.tracks[1].name).toBe('Bass');
    expect(score.tracks[1].midiProgram).toBe(32);
  });

  it('excludes tracks whose trackSelections.include is false', () => {
    const score = twoTrackScore();
    const bytes = exportMidi(score, codec);
    const buffer = toArrayBuffer(bytes);
    const summary = analyzeMidi(buffer, codec);
    const options = defaultMidiImportOptions(summary);
    options.trackSelections[1].include = false;

    const { score: imported } = importMidi(buffer, options, codec);
    expect(imported.tracks).toHaveLength(1);
    expect(imported.tracks[0].name).toBe('Treble');
  });

  it('quantizes note starts/durations to the requested grid', () => {
    const { score } = importFixture(twinkleScore, { quantizeGrid: 'sixteenth' });
    const quarterTicks = 480;
    for (const note of allNotes(score)) {
      expect(note.startTick % (quarterTicks / 4)).toBe(0);
    }
  });

  it('reproduces the same pitch content and note count as the exported fixture when quantized to sixteenths', () => {
    const source = twinkleScore();
    const { score } = importFixture(twinkleScore, { quantizeGrid: 'sixteenth' });

    const sourceNotes = allNotes(source).sort((a, b) => a.startTick - b.startTick);
    const importedNotes = allNotes(score).sort((a, b) => a.startTick - b.startTick);

    expect(importedNotes).toHaveLength(sourceNotes.length);
    for (let i = 0; i < sourceNotes.length; i += 1) {
      expect(pitchToMidi(importedNotes[i].pitch)).toBe(pitchToMidi(sourceNotes[i].pitch));
      expect(importedNotes[i].startTick).toBe(sourceNotes[i].startTick);
      expect(importedNotes[i].durationTicks).toBe(sourceNotes[i].durationTicks);
    }
  });

  it('routes a percussion-selected track to channel 9 and clef "percussion"', () => {
    const score = twinkleScore();
    const bytes = exportMidi(score, codec);
    const buffer = toArrayBuffer(bytes);
    const summary = analyzeMidi(buffer, codec);
    const options = defaultMidiImportOptions(summary);
    options.trackSelections[0].clef = 'percussion';

    const { score: imported } = importMidi(buffer, options, codec);
    expect(imported.tracks[0].clef).toBe('percussion');
    expect(imported.tracks[0].midiChannel).toBe(9);
  });

  it('splits into "Piano RH"/"Piano LH" tracks when pianoStaffSplit is set', () => {
    const { score } = importFixture(chordScore, { pianoStaffSplit: true, splitPointMidi: 60 });
    const names = score.tracks.map((t) => t.name);
    expect(names).toEqual(['Piano RH', 'Piano LH']);
    expect(score.tracks[0].clef).toBe('treble');
    expect(score.tracks[1].clef).toBe('bass');

    const errors = validateScore(score).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('drops notes shorter than minDurationTicks and warns', () => {
    const midi = new Midi();
    midi.header.fromJSON({ name: 'Short Notes', ppq: 480, meta: [], tempos: [{ ticks: 0, bpm: 120 }], timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }], keySignatures: [] });
    const track = midi.addTrack();
    track.name = 'Piano';
    track.addNote({ midi: 60, ticks: 0, durationTicks: 2, velocity: 0.8 }); // extremely short
    track.addNote({ midi: 62, ticks: 480, durationTicks: 480, velocity: 0.8 });

    const buffer = toArrayBuffer(midi.toArray());
    const summary = analyzeMidi(buffer, codec);
    const options = { ...defaultMidiImportOptions(summary), minDurationTicks: 30 };
    const { score, warnings } = importMidi(buffer, options, codec);

    expect(allNotes(score).filter(isNoteEvent)).toHaveLength(1);
    expect(warnings.some((w) => w.includes('dropped') && w.includes('shorter than'))).toBe(true);
    // Only the short-note stage changed anything here - merge/overlap stages must stay silent.
    expect(warnings.some((w) => w.includes('merged'))).toBe(false);
    expect(warnings.some((w) => w.includes('trimmed'))).toBe(false);
  });

  it('merges near-duplicate same-pitch onsets when mergeNearDuplicates is true, warning only about the merge', () => {
    const midi = new Midi();
    midi.header.fromJSON({ name: 'Duplicates', ppq: 480, meta: [], tempos: [{ ticks: 0, bpm: 120 }], timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }], keySignatures: [] });
    const track = midi.addTrack();
    track.name = 'Piano';
    // Two near-identical, overlapping C4 triggers 10 ticks apart - an accidental
    // double-trigger, not a deliberate chord/repeat - plus an unrelated D4 note.
    // importMidi's same-pitch-overlap guard (also used for sustain extension) first
    // clamps the earlier note's raw duration down to that 10-tick onset gap, so
    // minDurationTicks is set below 10 here to isolate the merge stage: this test
    // is about attributing the resulting single note to "merged", not "dropped".
    track.addNote({ midi: 60, ticks: 0, durationTicks: 470, velocity: 0.5 });
    track.addNote({ midi: 60, ticks: 10, durationTicks: 460, velocity: 0.9 });
    track.addNote({ midi: 62, ticks: 960, durationTicks: 480, velocity: 0.8 });

    const buffer = toArrayBuffer(midi.toArray());
    const summary = analyzeMidi(buffer, codec);
    const options = { ...defaultMidiImportOptions(summary), quantizeGrid: null, mergeNearDuplicates: true, minDurationTicks: 1 };
    const { score, warnings } = importMidi(buffer, options, codec);

    const notes = allNotes(score)
      .filter(isNoteEvent)
      .sort((a, b) => a.startTick - b.startTick);
    expect(notes).toHaveLength(2); // the two C4 duplicates collapsed into one, plus the D4
    expect(notes[0].startTick).toBe(0);
    expect(notes[0].durationTicks).toBe(470); // spans through the later onset's end (10 + 460)

    expect(warnings.some((w) => w.includes('merged') && w.includes('near-duplicate'))).toBe(true);
    // The merge must not be misattributed to the short-note or overlap stages.
    expect(warnings.some((w) => w.includes('dropped'))).toBe(false);
    expect(warnings.some((w) => w.includes('trimmed'))).toBe(false);
  });

  it('preserves overlapping different-pitch notes for voice allocation and playback', () => {
    const midi = new Midi();
    midi.header.fromJSON({ name: 'Polyphony', ppq: 480, meta: [], tempos: [{ ticks: 0, bpm: 120 }], timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }], keySignatures: [] });
    const track = midi.addTrack();
    track.name = 'Piano';
    // A held C4 with an entering D4 is valid polyphony. The importer used to
    // place every raw note in one temporary voice and trim C4 to D4's onset
    // before voice allocation, so playback lost the sustain even though the
    // allocator can represent these as independent voices.
    track.addNote({ midi: 60, ticks: 0, durationTicks: 960, velocity: 0.8 });
    track.addNote({ midi: 62, ticks: 480, durationTicks: 480, velocity: 0.8 });

    const buffer = toArrayBuffer(midi.toArray());
    const summary = analyzeMidi(buffer, codec);
    const options = { ...defaultMidiImportOptions(summary), quantizeGrid: null };
    const { score, warnings } = importMidi(buffer, options, codec);

    const notes = allNotes(score)
      .filter(isNoteEvent)
      .sort((a, b) => a.startTick - b.startTick);
    expect(notes).toHaveLength(2);
    expect(notes[0].durationTicks).toBe(960);
    expect(notes[1].durationTicks).toBe(480);

    expect(warnings.some((w) => w.includes('trimmed'))).toBe(false);
    expect(warnings.some((w) => w.includes('dropped'))).toBe(false);
    expect(warnings.some((w) => w.includes('merged'))).toBe(false);
  });

  it('preserves raw overlapping repeated pitches when timing cleanup is off', () => {
    const midi = new Midi();
    midi.header.fromJSON({ name: 'Raw Repeated Pitch Overlap', ppq: 480, meta: [], tempos: [{ ticks: 0, bpm: 120 }], timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }], keySignatures: [] });
    const track = midi.addTrack();
    track.name = 'Piano';
    track.addNote({ midi: 60, ticks: 0, durationTicks: 500, velocity: 0.8 });
    track.addNote({ midi: 60, ticks: 480, durationTicks: 480, velocity: 0.8 });

    const buffer = toArrayBuffer(midi.toArray());
    const summary = analyzeMidi(buffer, codec);
    const options = { ...defaultMidiImportOptions(summary), quantizeGrid: null, minDurationTicks: 1 };
    const { score, warnings } = importMidi(buffer, options, codec);

    const notes = allNotes(score)
      .filter(isNoteEvent)
      .sort((a, b) => a.startTick - b.startTick);
    expect(notes.map((note) => [pitchToMidi(note.pitch), note.startTick, note.durationTicks])).toEqual([
      [60, 0, 500],
      [60, 480, 480],
    ]);
    expect(warnings.some((w) => w.includes('trimmed'))).toBe(false);
  });

  it('trims overlapping repeated pitches and warns without touching independent pitches', () => {
    const midi = new Midi();
    midi.header.fromJSON({ name: 'Repeated Pitch Overlap', ppq: 480, meta: [], tempos: [{ ticks: 0, bpm: 120 }], timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }], keySignatures: [] });
    const track = midi.addTrack();
    track.name = 'Piano';
    // Coarse quantization can create a residual same-pitch overlap even when
    // the raw MIDI did not overlap. That repeated C4 should be trimmed, but
    // the overlapping E4 must keep its full duration as independent polyphony.
    track.addNote({ midi: 60, ticks: 490, durationTicks: 1440, velocity: 0.8 });
    track.addNote({ midi: 64, ticks: 720, durationTicks: 960, velocity: 0.8 });
    track.addNote({ midi: 60, ticks: 1930, durationTicks: 480, velocity: 0.8 });

    const buffer = toArrayBuffer(midi.toArray());
    const summary = analyzeMidi(buffer, codec);
    const options = { ...defaultMidiImportOptions(summary), quantizeGrid: 'half' as const, minDurationTicks: 1 };
    const { score, warnings } = importMidi(buffer, options, codec);

    const notes = allNotes(score)
      .filter(isNoteEvent)
      .sort((a, b) => a.startTick - b.startTick || pitchToMidi(a.pitch) - pitchToMidi(b.pitch));
    expect(notes).toHaveLength(3);
    expect(notes.map((n) => [pitchToMidi(n.pitch), n.startTick, n.durationTicks])).toEqual([
      [60, 960, 960],
      [64, 960, 960],
      [60, 1920, 960],
    ]);
    expect(warnings.some((w) => w.includes('trimmed') && w.includes('overlapping'))).toBe(true);
  });

  it('clamps only sustain-created same-pitch overlap, not the raw note length', () => {
    const midi = new Midi();
    midi.header.fromJSON({ name: 'Sustain Repeated Pitch', ppq: 480, meta: [], tempos: [{ ticks: 0, bpm: 120 }], timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }], keySignatures: [] });
    const track = midi.addTrack();
    track.name = 'Piano';
    track.addNote({ midi: 60, ticks: 0, durationTicks: 480, velocity: 0.8 });
    track.addNote({ midi: 60, ticks: 720, durationTicks: 240, velocity: 0.8 });
    track.addCC({ number: 64, ticks: 0, value: 1 });
    track.addCC({ number: 64, ticks: 960, value: 0 });

    const buffer = toArrayBuffer(midi.toArray());
    const summary = analyzeMidi(buffer, codec);
    const options = { ...defaultMidiImportOptions(summary), quantizeGrid: null, minDurationTicks: 1 };
    const { score } = importMidi(buffer, options, codec);

    const notes = allNotes(score)
      .filter(isNoteEvent)
      .sort((a, b) => a.startTick - b.startTick);
    expect(notes.map((note) => [pitchToMidi(note.pitch), note.startTick, note.durationTicks])).toEqual([
      [60, 0, 720],
      [60, 720, 240],
    ]);
  });

  it('extends a note through a held sustain pedal when sustainPedal is "extend"', () => {
    const midi = new Midi();
    midi.header.fromJSON({ name: 'Sustain', ppq: 480, meta: [], tempos: [{ ticks: 0, bpm: 120 }], timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }], keySignatures: [] });
    const track = midi.addTrack();
    track.name = 'Piano';
    // Note released at tick 480, but pedal is held down through tick 960.
    track.addNote({ midi: 60, ticks: 0, durationTicks: 480, velocity: 0.8 });
    track.addCC({ number: 64, ticks: 0, value: 1 });
    track.addCC({ number: 64, ticks: 960, value: 0 });

    const buffer = toArrayBuffer(midi.toArray());
    const summary = analyzeMidi(buffer, codec);
    const options = { ...defaultMidiImportOptions(summary), quantizeGrid: null };
    const { score } = importMidi(buffer, options, codec);

    const [note] = allNotes(score);
    expect(note.durationTicks).toBe(960);
  });

  it('does not extend a note when sustainPedal is "ignore"', () => {
    const midi = new Midi();
    midi.header.fromJSON({ name: 'Sustain', ppq: 480, meta: [], tempos: [{ ticks: 0, bpm: 120 }], timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }], keySignatures: [] });
    const track = midi.addTrack();
    track.name = 'Piano';
    track.addNote({ midi: 60, ticks: 0, durationTicks: 480, velocity: 0.8 });
    track.addCC({ number: 64, ticks: 0, value: 1 });
    track.addCC({ number: 64, ticks: 960, value: 0 });

    const buffer = toArrayBuffer(midi.toArray());
    const summary = analyzeMidi(buffer, codec);
    const options = { ...defaultMidiImportOptions(summary), quantizeGrid: null, sustainPedal: 'ignore' as const };
    const { score } = importMidi(buffer, options, codec);

    const [note] = allNotes(score);
    expect(note.durationTicks).toBe(480);
  });

  it('always includes the "performance timing, not full notation" warning', () => {
    const { warnings } = importFixture(twinkleScore);
    expect(warnings.some((w) => /performance timing|approximates/i.test(w))).toBe(true);
  });

  it('warns and produces an empty-track score when no selections are included', () => {
    const score = twinkleScore();
    const bytes = exportMidi(score, codec);
    const buffer = toArrayBuffer(bytes);
    const summary = analyzeMidi(buffer, codec);
    const options = defaultMidiImportOptions(summary);
    options.trackSelections.forEach((s) => {
      s.include = false;
    });

    const { score: imported, warnings } = importMidi(buffer, options, codec);
    expect(imported.tracks).toEqual([]);
    expect(warnings.some((w) => w.includes('No tracks were selected'))).toBe(true);
  });

  it('estimates a key signature when detectKey is true and defaults to C major when false', () => {
    const { score: withDetect } = importFixture(twinkleScore, { detectKey: true, quantizeGrid: null });
    const { score: withoutDetect } = importFixture(twinkleScore, { detectKey: false, quantizeGrid: null });

    expect(withDetect.tracks[0].measures[0].keySignature).toEqual({ fifths: 0, mode: 'major' });
    expect(withoutDetect.tracks[0].measures[0].keySignature).toEqual({ fifths: 0, mode: 'major' });
  });
});
