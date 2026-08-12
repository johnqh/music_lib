/**
 * Importing a MIDI file must not move its notes in time.
 *
 * The bug this pins: import snapped every file to a fixed sixteenth grid, so a
 * file written in triplets or swing came back with each note up to 42ms out of
 * place at 120bpm. Every note was present and at the right pitch, which is
 * what made it read as "the timing is wrong" rather than as dropped notes.
 * Onsets are compared in seconds, not ticks, because seconds are what a
 * listener hears.
 */
import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { createMusicIo } from '@sudobility/music_io/mocks';
import { analyzeMidi } from './analyze.js';
import { importMidi } from './import.js';
import { defaultMidiImportOptions } from './import-options.js';
import { TempoMap } from '../../domain/time/tempo-map.js';

const BPM = 120;
const SECONDS_PER_BEAT = 60 / BPM;
/** A millisecond. Well under what anyone can hear, and 42x under the old error. */
const TOLERANCE_SECONDS = 0.001;

async function importedOnsetSeconds(beats: number[], lengthBeats: number): Promise<number[]> {
  const midi = new Midi();
  midi.header.setTempo(BPM);
  const ppq = midi.header.ppq;
  const track = midi.addTrack();
  for (const beat of beats) {
    track.addNote({
      midi: 60,
      ticks: Math.round(beat * ppq),
      durationTicks: Math.round(lengthBeats * ppq),
    });
  }

  const bytes = midi.toArray().buffer as ArrayBuffer;
  const codec = createMusicIo().midiCodec;
  const summary = analyzeMidi(bytes, codec);
  const { score } = importMidi(bytes, defaultMidiImportOptions(summary), codec);

  const map = new TempoMap(score.tempoMap, score.ppq);
  const notes = score.tracks[0].measures
    .flatMap((measure) => measure.voices.flatMap((voice) => voice.events))
    .filter((event): event is typeof event & { startTick: number } => 'pitch' in event);
  return notes.map((note) => map.ticksToSeconds(note.startTick));
}

async function expectPreserved(beats: number[], lengthBeats: number): Promise<void> {
  const imported = await importedOnsetSeconds(beats, lengthBeats);
  expect(imported).toHaveLength(beats.length);
  beats.forEach((beat, i) => {
    expect(Math.abs(imported[i] - beat * SECONDS_PER_BEAT)).toBeLessThan(TOLERANCE_SECONDS);
  });
}

describe('midi import timing', () => {
  it('keeps eighth-note triplets evenly spaced', async () => {
    await expectPreserved([0, 1 / 3, 2 / 3, 1, 4 / 3, 5 / 3, 2, 7 / 3, 8 / 3, 3, 10 / 3, 11 / 3], 1 / 3);
  });

  it('keeps swung eighths swung', async () => {
    await expectPreserved([0, 2 / 3, 1, 5 / 3, 2, 8 / 3, 3, 11 / 3], 1 / 3);
  });

  it('keeps straight sixteenths where they were', async () => {
    await expectPreserved([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75], 0.25);
  });

  it('keeps sixteenths and triplets together in one file', async () => {
    await expectPreserved([0, 0.25, 0.5, 0.75, 1, 4 / 3, 5 / 3, 2, 2.25, 2.5, 2.75, 3], 0.25);
  });

  it('keeps performance timing when no grid fits', async () => {
    const playedTicks = [0, 267, 494, 741, 941, 1207, 1445, 1668];
    await expectPreserved(playedTicks.map((tick) => tick / 480), 0.25);
  });
});
