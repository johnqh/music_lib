import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { exportMidi, safeFilename } from './export';
import { createEmptyScore } from '../../domain/score/factory';
import { createId } from '../../domain/score/ids';
import type { NoteEvent, Score } from '@sudobility/music_types';
import { chordScore, twinkleScore, twoTrackScore } from '../../test/fixtures';

describe('exportMidi', () => {
  it('exports PPQ, tempo, and title as the MIDI header', () => {
    const score = twinkleScore();
    const bytes = exportMidi(score);
    expect(bytes.length).toBeGreaterThan(0);

    const midi = new Midi(bytes);
    expect(midi.header.ppq).toBe(score.ppq);
    expect(midi.header.tempos).toHaveLength(1);
    expect(midi.header.tempos[0].bpm).toBeCloseTo(120, 5);
    expect(midi.header.name).toBe('Twinkle Twinkle Little Star');
  });

  it('exports one MIDI track per score track, with name/program/channel and every note', () => {
    const score = twoTrackScore();
    const midi = new Midi(exportMidi(score));

    expect(midi.tracks).toHaveLength(2);
    const [treble, bass] = midi.tracks;
    expect(treble.name).toBe('Treble');
    expect(treble.channel).toBe(0);
    expect(treble.instrument.number).toBe(0);

    expect(bass.name).toBe('Bass');
    expect(bass.channel).toBe(1);
    expect(bass.instrument.number).toBe(32);

    const expectedTrebleNotes = score.tracks[0].measures.flatMap((m) => m.voices.flatMap((v) => v.events));
    expect(treble.notes).toHaveLength(expectedTrebleNotes.length);
  });

  it("routes percussion-clef tracks to MIDI channel 9 regardless of the track's own midiChannel", () => {
    const score = createEmptyScore({
      title: 'Drums',
      measures: 1,
      tracks: [{ name: 'Drums', clef: 'percussion', midiChannel: 3, midiProgram: 0 }],
    });
    // @tonejs/midi's own re-parser infers a track's channel from its note-on
    // events (not from the program-change/CC channel field), so the track
    // needs at least one note for this round-trip assertion to be meaningful.
    const track = score.tracks[0];
    const voice = track.measures[0].voices[0];
    voice.events = [
      {
        id: createId(),
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: 480,
        velocity: 100,
        voiceId: voice.id,
        trackId: track.id,
      },
      { id: createId(), startTick: 480, durationTicks: 1440, voiceId: voice.id, trackId: track.id },
    ];

    const midi = new Midi(exportMidi(score));
    expect(midi.tracks[0].channel).toBe(9);
  });

  it('exports chord (simultaneous same-duration) notes as distinct simultaneous MIDI notes', () => {
    const score = chordScore();
    const midi = new Midi(exportMidi(score));
    const firstMeasureNotes = midi.tracks[0].notes.filter((n) => n.ticks === 0);
    expect(firstMeasureNotes).toHaveLength(3); // C E G
    expect(firstMeasureNotes.map((n) => n.midi).sort((a, b) => a - b)).toEqual([60, 64, 67]);
  });

  it('rejoins a tied note split across a measure boundary into one MIDI note', () => {
    const ppq = 480;
    const trackId = createId();
    const voice1 = createId();
    const voice2 = createId();
    const tiedNote: NoteEvent = {
      id: createId(),
      pitch: { step: 'C', accidental: 0, octave: 4 },
      startTick: 1440,
      durationTicks: 480,
      velocity: 90,
      voiceId: voice1,
      trackId,
      tieStart: true,
    };
    const tiedContinuation: NoteEvent = {
      ...tiedNote,
      id: createId(),
      startTick: 1920,
      voiceId: voice2,
      tieStart: undefined,
      tieStop: true,
    };
    const score: Score = {
      id: createId(),
      version: 1,
      ppq,
      metadata: { title: 'Tie Test', createdAt: '', updatedAt: '' },
      tempoMap: [{ id: createId(), tick: 0, bpm: 120 }],
      tracks: [
        {
          id: trackId,
          name: 'Piano',
          instrumentName: 'Piano',
          midiProgram: 0,
          midiChannel: 0,
          clef: 'treble',
          volume: 1,
          pan: 0,
          muted: false,
          solo: false,
          measures: [
            {
              id: createId(),
              index: 0,
              startTick: 0,
              durationTicks: 1920,
              timeSignature: { numerator: 4, denominator: 4 },
              keySignature: { fifths: 0, mode: 'major' },
              voices: [
                {
                  id: voice1,
                  name: 'Voice 1',
                  events: [
                    { id: createId(), startTick: 0, durationTicks: 1440, voiceId: voice1, trackId },
                    tiedNote,
                  ],
                },
              ],
            },
            {
              id: createId(),
              index: 1,
              startTick: 1920,
              durationTicks: 1920,
              timeSignature: { numerator: 4, denominator: 4 },
              keySignature: { fifths: 0, mode: 'major' },
              voices: [
                {
                  id: voice2,
                  name: 'Voice 1',
                  events: [
                    tiedContinuation,
                    { id: createId(), startTick: 2400, durationTicks: 1440, voiceId: voice2, trackId },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const midi = new Midi(exportMidi(score));
    expect(midi.tracks[0].notes).toHaveLength(1);
    expect(midi.tracks[0].notes[0].ticks).toBe(1440);
    expect(midi.tracks[0].notes[0].durationTicks).toBe(960);
  });

  it('encodes track volume/pan as CC7/CC10 at track start', () => {
    const score = createEmptyScore({
      title: 'Pan Test',
      measures: 1,
      tracks: [{ name: 'Piano', volume: 0.5, pan: -1 }],
    });
    const midi = new Midi(exportMidi(score));
    const volumeEvents = midi.tracks[0].controlChanges[7];
    const panEvents = midi.tracks[0].controlChanges[10];
    // MIDI CC values are 7-bit (0-127), so a round trip through encode/decode
    // loses sub-1/127 precision (~0.0079) - tolerance reflects that, not exactness.
    expect(volumeEvents[0].value).toBeCloseTo(0.5, 2);
    expect(panEvents[0].value).toBeCloseTo(0, 5); // pan -1 -> normalized 0, exact
  });
});

describe('safeFilename', () => {
  it('lowercases and hyphenates', () => {
    expect(safeFilename('My Song!')).toBe('my-song');
  });

  it('collapses punctuation runs into a single hyphen and trims edges', () => {
    expect(safeFilename('Score #2 (draft)')).toBe('score-2-draft');
  });

  it('falls back to "untitled" for empty/punctuation-only input', () => {
    expect(safeFilename('')).toBe('untitled');
    expect(safeFilename('   ***   ')).toBe('untitled');
  });
});
