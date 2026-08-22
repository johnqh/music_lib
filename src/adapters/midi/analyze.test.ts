import { testMidiCodec } from '../../test/platform.js';
import { describe, expect, it } from 'vitest';
import { analyzeMidi } from './analyze.js';
import { exportMidi } from './export.js';
import { createEmptyScore } from '@sudobility/music_types';
import { createId } from '@sudobility/music_types';
import { chordScore, twoTrackScore } from '../../test/fixtures.js';
import * as midiLib from '@tonejs/midi';

// The real codec, via the mocks entry: MIDI encoding is pure byte manipulation,
// and the mocks entry -- unlike music_io/web -- does not import music_lib.
const codec = testMidiCodec();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer as ArrayBuffer;
}

describe('analyzeMidi', () => {
  it('summarizes PPQ, duration, tempo events, and time signatures', () => {
    const score = chordScore();
    const summary = analyzeMidi(toArrayBuffer(exportMidi(score, codec)), codec);

    expect(summary.ppq).toBe(score.ppq);
    // Standard MIDI encodes tempo as integer microseconds-per-quarter-note,
    // so bpm isn't perfectly reversible through export -> re-parse.
    expect(summary.tempoEvents).toHaveLength(1);
    expect(summary.tempoEvents[0].tick).toBe(0);
    expect(summary.tempoEvents[0].bpm).toBeCloseTo(90, 2);
    expect(summary.timeSignatures).toEqual([
      { tick: 0, numerator: 4, denominator: 4 },
    ]);
    expect(summary.durationSeconds).toBeGreaterThan(0);
  });

  it('summarizes one entry per track with name/channel/program/note count', () => {
    const score = twoTrackScore();
    const summary = analyzeMidi(toArrayBuffer(exportMidi(score, codec)), codec);

    expect(summary.tracks).toHaveLength(2);
    const [treble, bass] = summary.tracks;
    expect(treble.name).toBe('Treble');
    expect(treble.channel).toBe(0);
    expect(treble.program).toBe(0);
    expect(treble.noteCount).toBe(16); // 4 measures x 4 quarters
    expect(treble.isPercussion).toBe(false);
    expect(treble.averageMidi).not.toBeNull();

    expect(bass.name).toBe('Bass');
    expect(bass.channel).toBe(1);
    expect(bass.program).toBe(32);
    expect(bass.noteCount).toBe(4); // 4 whole notes
  });

  it('flags a percussion (channel-9) track and reports null averageMidi for a note-free track', () => {
    const score = createEmptyScore({
      title: 'Mixed',
      measures: 1,
      tracks: [
        { name: 'Drums', clef: 'percussion', midiChannel: 3, midiProgram: 0 },
        { name: 'Empty', clef: 'treble' },
      ],
    });
    const drumTrack = score.tracks[0];
    const drumVoice = drumTrack.measures[0].voices[0];
    drumVoice.events = [
      {
        id: createId(),
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: 480,
        velocity: 100,
        voiceId: drumVoice.id,
        trackId: drumTrack.id,
      },
      {
        id: createId(),
        startTick: 480,
        durationTicks: 1440,
        voiceId: drumVoice.id,
        trackId: drumTrack.id,
      },
    ];

    const summary = analyzeMidi(toArrayBuffer(exportMidi(score, codec)), codec);
    const drums = summary.tracks.find(t => t.name === 'Drums');
    const empty = summary.tracks.find(t => t.name === 'Empty');

    expect(drums?.isPercussion).toBe(true);
    expect(drums?.channel).toBe(9);
    expect(drums?.noteCount).toBe(1);
    expect(drums?.averageMidi).toBe(60);

    // A note-free track produces no MIDI notes at all, so @tonejs/midi's own
    // re-parse can't recover a channel from note-on events (see export.test.ts) -
    // only noteCount/averageMidi are meaningful here.
    expect(empty?.noteCount).toBe(0);
    expect(empty?.averageMidi).toBeNull();
  });
});

describe('analyzeMidi: detected quantization grid', () => {
  /** A one-track file at `ppq`, with a note at each of `onsets` lasting `lengthBeats`. */
  function fileWith(onsets: number[], lengthBeats: number): ArrayBuffer {
    const { Midi } = midiLib;
    const midi = new Midi();
    midi.header.setTempo(120);
    const ppq = midi.header.ppq;
    const track = midi.addTrack();
    for (const beat of onsets) {
      track.addNote({
        midi: 60,
        ticks: Math.round(beat * ppq),
        durationTicks: Math.round(lengthBeats * ppq),
      });
    }
    return midi.toArray().buffer as ArrayBuffer;
  }

  it('reports the triplet grid for a file written in triplets', () => {
    const onsets = [0, 1 / 3, 2 / 3, 1, 4 / 3, 5 / 3, 2, 7 / 3, 8 / 3];
    const summary = analyzeMidi(fileWith(onsets, 1 / 3), codec);
    expect(summary.detectedGrid).toEqual({ grid: 'eighth', triplet: true });
  });

  it('takes note ends into account, not just onsets', () => {
    // Staccato quarters: quarter onsets, eighth-note ends. Reporting "quarter"
    // would stretch every note to fill its beat.
    const summary = analyzeMidi(fileWith([0, 1, 2, 3, 4, 5, 6, 7], 0.5), codec);
    expect(summary.detectedGrid).toEqual({ grid: 'eighth', triplet: false });
  });
});

describe('analyzeMidi: percussion counts toward the grid', () => {
  it('picks a grid fine enough for the drums, not just the melody', () => {
    const { Midi } = midiLib;
    const midi = new Midi();
    midi.header.setTempo(120);
    const ppq = midi.header.ppq;

    const melody = midi.addTrack();
    for (let i = 0; i < 16; i++)
      melody.addNote({ midi: 60, ticks: i * ppq, durationTicks: ppq });

    // A hi-hat on thirty-seconds. The grid is applied to every track, so one
    // chosen from the melody alone would snap the whole kit onto the beat.
    const drums = midi.addTrack();
    drums.channel = 9;
    for (let i = 0; i < 128; i++)
      drums.addNote({
        midi: 42,
        ticks: Math.round((i * ppq) / 8),
        durationTicks: 10,
      });

    const summary = analyzeMidi(midi.toArray().buffer as ArrayBuffer, codec);
    expect(summary.detectedGrid).toEqual({
      grid: 'thirtysecond',
      triplet: false,
    });
  });
});
