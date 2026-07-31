/**
 * MusicXML round-trip tests (Task 8 brief): fixture score -> exportMusicXml
 * -> importMusicXml should reproduce the same musical content exactly
 * (MusicXML, unlike MIDI, carries full notation semantics, so this is a
 * much stronger guarantee than the MIDI round trip's "reproduces after
 * quantization" — no quantization is involved here at all). Covers melody,
 * chords, two voices, ties across a barline, articulations, and 6/8, per
 * the brief.
 */
import { describe, expect, it } from 'vitest';
import { exportMusicXml } from './export.js';
import { importMusicXml } from './import.js';
import { createId } from '../../domain/score/ids.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { Measure, NoteEvent, Score, Track } from '@sudobility/music_types';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import { allNotes } from '../../domain/score/queries.js';
import { measureDurationTicks, ticksFor } from '../../domain/time/ticks.js';
import { validateScore } from '../../domain/validation/validator.js';
import { chordScore, twinkleScore, twoTrackScore } from '../../test/fixtures.js';
import { MockXmlParser } from '@sudobility/music_io/mocks';

const parser = new MockXmlParser();

function roundTrip(source: Score): { imported: Score; warnings: string[] } {
  const xml = exportMusicXml(source);
  const { score, warnings } = importMusicXml(xml, parser);
  return { imported: score, warnings };
}

type NoteFingerprint = { startTick: number; durationTicks: number; midi: number; tieStart: boolean; tieStop: boolean; articulation: string | undefined };

function fingerprint(score: Score): NoteFingerprint[] {
  return allNotes(score)
    .map((n) => ({
      startTick: n.startTick,
      durationTicks: n.durationTicks,
      midi: pitchToMidi(n.pitch),
      tieStart: Boolean(n.tieStart),
      tieStop: Boolean(n.tieStop),
      articulation: n.articulation,
    }))
    .sort((a, b) => a.startTick - b.startTick || a.midi - b.midi);
}

// ---- Hand-built fixtures for cases the shared fixtures don't cover -------------

const PPQ = 480;
const FOUR_FOUR = { numerator: 4, denominator: 4 };
const C_MAJOR = { fifths: 0, mode: 'major' as const };

function baseTrack(overrides: Partial<Track> & { measures: Measure[] }): Track {
  return {
    id: createId(),
    name: 'Piano',
    instrumentName: 'Piano',
    midiProgram: 0,
    midiChannel: 0,
    clef: 'treble',
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
    ...overrides,
  };
}

function baseScore(title: string, tracks: Track[]): Score {
  return {
    id: createId(),
    version: 1,
    ppq: PPQ,
    metadata: { title, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
    tempoMap: [{ id: createId(), tick: 0, bpm: 110 }],
    tracks,
  };
}

/** Two independent voices sharing one measure: a treble line and a sustained bass note. */
function twoVoiceScore(): Score {
  const trackId = createId();
  const measureTicks = measureDurationTicks(FOUR_FOUR, PPQ);
  const q = ticksFor('quarter', PPQ);
  const voice1Id = createId();
  const voice2Id = createId();

  const voice1Events: NoteEvent[] = [
    { id: createId(), pitch: { step: 'E', accidental: 0, octave: 5 }, startTick: 0, durationTicks: q, velocity: 80, voiceId: voice1Id, trackId },
    { id: createId(), pitch: { step: 'D', accidental: 0, octave: 5 }, startTick: q, durationTicks: q, velocity: 80, voiceId: voice1Id, trackId },
    { id: createId(), pitch: { step: 'C', accidental: 0, octave: 5 }, startTick: 2 * q, durationTicks: q, velocity: 80, voiceId: voice1Id, trackId },
    { id: createId(), pitch: { step: 'D', accidental: 0, octave: 5 }, startTick: 3 * q, durationTicks: q, velocity: 80, voiceId: voice1Id, trackId },
  ];
  const voice2Events: NoteEvent[] = [
    { id: createId(), pitch: { step: 'C', accidental: 0, octave: 3 }, startTick: 0, durationTicks: measureTicks, velocity: 80, voiceId: voice2Id, trackId },
  ];

  const measure: Measure = {
    id: createId(),
    index: 0,
    startTick: 0,
    durationTicks: measureTicks,
    timeSignature: FOUR_FOUR,
    keySignature: C_MAJOR,
    voices: [
      { id: voice1Id, name: 'Voice 1', events: voice1Events },
      { id: voice2Id, name: 'Voice 2', events: voice2Events },
    ],
  };

  return baseScore('Two Voices', [baseTrack({ id: trackId, measures: [measure] })]);
}

/** A G4 half note tied across the barline from measure 1 (last two beats) into measure 2 (first two beats), then a new note. */
function tieAcrossBarlineScore(): Score {
  const trackId = createId();
  const measureTicks = measureDurationTicks(FOUR_FOUR, PPQ);
  const half = ticksFor('half', PPQ);
  const voice1Id = createId();
  const voice2Id = createId();

  const measure1: Measure = {
    id: createId(),
    index: 0,
    startTick: 0,
    durationTicks: measureTicks,
    timeSignature: FOUR_FOUR,
    keySignature: C_MAJOR,
    voices: [
      {
        id: voice1Id,
        name: 'Voice 1',
        events: [
          { id: createId(), pitch: { step: 'C', accidental: 0, octave: 4 }, startTick: 0, durationTicks: half, velocity: 80, voiceId: voice1Id, trackId },
          { id: createId(), pitch: { step: 'G', accidental: 0, octave: 4 }, startTick: half, durationTicks: half, velocity: 80, voiceId: voice1Id, trackId, tieStart: true },
        ],
      },
    ],
  };
  const measure2: Measure = {
    id: createId(),
    index: 1,
    startTick: measureTicks,
    durationTicks: measureTicks,
    timeSignature: FOUR_FOUR,
    keySignature: C_MAJOR,
    voices: [
      {
        id: voice2Id,
        name: 'Voice 1',
        events: [
          { id: createId(), pitch: { step: 'G', accidental: 0, octave: 4 }, startTick: measureTicks, durationTicks: half, velocity: 80, voiceId: voice2Id, trackId, tieStop: true },
          { id: createId(), pitch: { step: 'A', accidental: 0, octave: 4 }, startTick: measureTicks + half, durationTicks: half, velocity: 80, voiceId: voice2Id, trackId },
        ],
      },
    ],
  };

  return baseScore('Tie Across Barline', [baseTrack({ measures: [measure1, measure2], id: trackId })]);
}

/** One measure, one note of each supported articulation. */
function articulationsScore(): Score {
  const trackId = createId();
  const measureTicks = measureDurationTicks(FOUR_FOUR, PPQ);
  const q = ticksFor('quarter', PPQ);
  const voiceId = createId();
  const articulations: NonNullable<NoteEvent['articulation']>[] = ['staccato', 'accent', 'tenuto', 'marcato'];

  const events: NoteEvent[] = articulations.map((articulation, i) => ({
    id: createId(),
    pitch: { step: 'C', accidental: 0, octave: 4 },
    startTick: i * q,
    durationTicks: q,
    velocity: 80,
    voiceId,
    trackId,
    articulation,
  }));

  const measure: Measure = {
    id: createId(),
    index: 0,
    startTick: 0,
    durationTicks: measureTicks,
    timeSignature: FOUR_FOUR,
    keySignature: C_MAJOR,
    voices: [{ id: voiceId, name: 'Voice 1', events }],
  };

  return baseScore('Articulations', [baseTrack({ measures: [measure], id: trackId })]);
}

/** Two 6/8 measures: a dotted-quarter + 3 eighths melody, one measure per bar. */
function sixEightScore(): Score {
  const trackId = createId();
  const ts = { numerator: 6, denominator: 8 };
  const measureTicks = measureDurationTicks(ts, PPQ);
  const dottedQuarter = ticksFor('dotted-quarter', PPQ);
  const eighth = ticksFor('eighth', PPQ);
  expect(dottedQuarter + 3 * eighth).toBe(measureTicks);

  const pitches: Array<[string, number]> = [
    ['G', 4],
    ['F', 4],
    ['E', 4],
    ['D', 4],
  ];

  const measures: Measure[] = [0, 1].map((measureIndex) => {
    const voiceId = createId();
    const [step0] = pitches[0];
    const events: NoteEvent[] = [
      {
        id: createId(),
        pitch: { step: step0 as NoteEvent['pitch']['step'], accidental: 0, octave: 4 },
        startTick: measureIndex * measureTicks,
        durationTicks: dottedQuarter,
        velocity: 80,
        voiceId,
        trackId,
      },
      ...[1, 2, 3].map(
        (i): NoteEvent => ({
          id: createId(),
          pitch: { step: pitches[i][0] as NoteEvent['pitch']['step'], accidental: 0, octave: pitches[i][1] },
          startTick: measureIndex * measureTicks + dottedQuarter + (i - 1) * eighth,
          durationTicks: eighth,
          velocity: 80,
          voiceId,
          trackId,
        }),
      ),
    ];
    return {
      id: createId(),
      index: measureIndex,
      startTick: measureIndex * measureTicks,
      durationTicks: measureTicks,
      timeSignature: ts,
      keySignature: C_MAJOR,
      voices: [{ id: voiceId, name: 'Voice 1', events }],
    };
  });

  return baseScore('Six Eight', [baseTrack({ measures, id: trackId })]);
}

// ---- Round-trip assertions, shared across fixtures -----------------------------

describe.each([
  ['twinkleScore (melody)', twinkleScore],
  ['chordScore (chords)', chordScore],
  ['twoTrackScore (multiple tracks)', twoTrackScore],
  ['twoVoiceScore (two voices in one measure)', twoVoiceScore],
  ['tieAcrossBarlineScore (tie across a barline)', tieAcrossBarlineScore],
  ['articulationsScore (all four articulations)', articulationsScore],
  ['sixEightScore (6/8 compound meter)', sixEightScore],
])('MusicXML round trip: %s', (_name, factory) => {
  it('reproduces every note exactly (pitch, start, duration, ties, articulation)', () => {
    const source = factory();
    const { imported } = roundTrip(source);
    expect(fingerprint(imported)).toEqual(fingerprint(source));
  });

  it('preserves the tempo map', () => {
    const source = factory();
    const { imported } = roundTrip(source);
    expect(imported.tempoMap).toHaveLength(source.tempoMap.length);
    source.tempoMap.forEach((tempo, i) => {
      expect(imported.tempoMap[i].tick).toBe(tempo.tick);
      expect(imported.tempoMap[i].bpm).toBeCloseTo(tempo.bpm, 1);
    });
  });

  it('preserves time and key signatures per measure, per track', () => {
    const source = factory();
    const { imported } = roundTrip(source);
    source.tracks.forEach((track, trackIndex) => {
      const importedTrack = imported.tracks[trackIndex];
      expect(importedTrack.measures.map((m) => m.timeSignature)).toEqual(track.measures.map((m) => m.timeSignature));
      expect(importedTrack.measures.map((m) => m.keySignature)).toEqual(track.measures.map((m) => m.keySignature));
    });
  });

  it('preserves the number of voices per measure, per track', () => {
    const source = factory();
    const { imported } = roundTrip(source);
    source.tracks.forEach((track, trackIndex) => {
      const importedTrack = imported.tracks[trackIndex];
      expect(importedTrack.measures.map((m) => m.voices.length)).toEqual(track.measures.map((m) => m.voices.length));
    });
  });

  it('produces a score with zero validateScore errors', () => {
    const { imported } = roundTrip(factory());
    const errors = validateScore(imported).filter((issue) => issue.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('imports without warnings for this adapter\'s own clean export', () => {
    const { warnings } = roundTrip(factory());
    expect(warnings).toEqual([]);
  });
});

describe('MusicXML round trip: track/instrument metadata', () => {
  it('preserves track name, MIDI program, and MIDI channel', () => {
    const source = twoTrackScore();
    const { imported } = roundTrip(source);
    source.tracks.forEach((track, i) => {
      expect(imported.tracks[i].name).toBe(track.name);
      expect(imported.tracks[i].midiProgram).toBe(track.midiProgram);
      expect(imported.tracks[i].midiChannel).toBe(track.midiChannel);
      expect(imported.tracks[i].clef).toBe(track.clef);
    });
  });

  it('preserves the score title', () => {
    const source = twinkleScore();
    const { imported } = roundTrip(source);
    expect(imported.metadata.title).toBe(source.metadata.title);
  });
});

describe('MusicXML round trip: chord grouping stays simultaneous', () => {
  it('every chord tone in the source lands on the same imported start tick', () => {
    const source = chordScore();
    const { imported } = roundTrip(source);

    // chordScore: each measure is a single voice with 3 simultaneous notes.
    imported.tracks[0].measures.forEach((measure) => {
      const notes = measure.voices[0].events.filter(isNoteEvent);
      expect(notes).toHaveLength(3);
      expect(new Set(notes.map((n) => n.startTick)).size).toBe(1);
    });
  });
});
