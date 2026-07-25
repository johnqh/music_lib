import { describe, expect, it } from 'vitest';
import { analyzeMidi } from './analyze';
import { exportMidi } from './export';
import { createEmptyScore } from '../../domain/score/factory';
import { createId } from '../../domain/score/ids';
import { chordScore, twoTrackScore } from '../../test/fixtures';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer as ArrayBuffer;
}

describe('analyzeMidi', () => {
  it('summarizes PPQ, duration, tempo events, and time signatures', () => {
    const score = chordScore();
    const summary = analyzeMidi(toArrayBuffer(exportMidi(score)));

    expect(summary.ppq).toBe(score.ppq);
    // Standard MIDI encodes tempo as integer microseconds-per-quarter-note,
    // so bpm isn't perfectly reversible through export -> re-parse.
    expect(summary.tempoEvents).toHaveLength(1);
    expect(summary.tempoEvents[0].tick).toBe(0);
    expect(summary.tempoEvents[0].bpm).toBeCloseTo(90, 2);
    expect(summary.timeSignatures).toEqual([{ tick: 0, numerator: 4, denominator: 4 }]);
    expect(summary.durationSeconds).toBeGreaterThan(0);
  });

  it('summarizes one entry per track with name/channel/program/note count', () => {
    const score = twoTrackScore();
    const summary = analyzeMidi(toArrayBuffer(exportMidi(score)));

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
      { id: createId(), startTick: 480, durationTicks: 1440, voiceId: drumVoice.id, trackId: drumTrack.id },
    ];

    const summary = analyzeMidi(toArrayBuffer(exportMidi(score)));
    const drums = summary.tracks.find((t) => t.name === 'Drums');
    const empty = summary.tracks.find((t) => t.name === 'Empty');

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
