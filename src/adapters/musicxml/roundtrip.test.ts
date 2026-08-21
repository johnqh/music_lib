/**
 * MusicXML round-trip tests (Task 8 brief): fixture score -> exportMusicXml
 * -> importMusicXml should reproduce the same musical content exactly
 * (MusicXML, unlike MIDI, carries full notation semantics, so this is a
 * much stronger guarantee than the MIDI round trip's "reproduces after
 * quantization" — no quantization is involved here at all). Covers melody,
 * chords, two voices, ties across a barline, articulations, and 6/8, per
 * the brief.
 */
import { testXmlParser } from '../../test/platform.js';
import { describe, expect, it } from 'vitest';
import { TEST_MUSICXML_WARNINGS } from '../../test/musicxml-warnings.js';
import { exportMusicXml } from './export.js';
import { importMusicXml } from './import.js';
import { createId } from '../../domain/score/ids.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { Measure, NoteEvent, Score, Track } from '@sudobility/music_types';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import { allNotes } from '../../domain/score/queries.js';
import {
  setChordSymbolCommand,
  setLyricCommand,
  toGraceNoteCommand,
  toggleSlurCommand,
} from '../../domain/commands/note-commands.js';
import { changeRepeatsCommand } from '../../domain/commands/structure-commands.js';
import { measureDurationTicks, ticksFor } from '../../domain/time/ticks.js';
import { validateScore } from '../../domain/validation/validator.js';
import {
  chordScore,
  twinkleScore,
  twoTrackScore,
} from '../../test/fixtures.js';

const parser = testXmlParser();

function roundTrip(source: Score): { imported: Score; warnings: string[] } {
  const xml = exportMusicXml(source);
  const { score, warnings } = importMusicXml(
    xml,
    parser,
    TEST_MUSICXML_WARNINGS
  );
  return { imported: score, warnings };
}

type NoteFingerprint = {
  startTick: number;
  durationTicks: number;
  midi: number;
  tieStart: boolean;
  tieStop: boolean;
  articulation: string | undefined;
};

function fingerprint(score: Score): NoteFingerprint[] {
  return allNotes(score)
    .map(n => ({
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
    metadata: {
      title,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
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
    {
      id: createId(),
      pitch: { step: 'E', accidental: 0, octave: 5 },
      startTick: 0,
      durationTicks: q,
      velocity: 80,
      voiceId: voice1Id,
      trackId,
    },
    {
      id: createId(),
      pitch: { step: 'D', accidental: 0, octave: 5 },
      startTick: q,
      durationTicks: q,
      velocity: 80,
      voiceId: voice1Id,
      trackId,
    },
    {
      id: createId(),
      pitch: { step: 'C', accidental: 0, octave: 5 },
      startTick: 2 * q,
      durationTicks: q,
      velocity: 80,
      voiceId: voice1Id,
      trackId,
    },
    {
      id: createId(),
      pitch: { step: 'D', accidental: 0, octave: 5 },
      startTick: 3 * q,
      durationTicks: q,
      velocity: 80,
      voiceId: voice1Id,
      trackId,
    },
  ];
  const voice2Events: NoteEvent[] = [
    {
      id: createId(),
      pitch: { step: 'C', accidental: 0, octave: 3 },
      startTick: 0,
      durationTicks: measureTicks,
      velocity: 80,
      voiceId: voice2Id,
      trackId,
    },
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

  return baseScore('Two Voices', [
    baseTrack({ id: trackId, measures: [measure] }),
  ]);
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
          {
            id: createId(),
            pitch: { step: 'C', accidental: 0, octave: 4 },
            startTick: 0,
            durationTicks: half,
            velocity: 80,
            voiceId: voice1Id,
            trackId,
          },
          {
            id: createId(),
            pitch: { step: 'G', accidental: 0, octave: 4 },
            startTick: half,
            durationTicks: half,
            velocity: 80,
            voiceId: voice1Id,
            trackId,
            tieStart: true,
          },
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
          {
            id: createId(),
            pitch: { step: 'G', accidental: 0, octave: 4 },
            startTick: measureTicks,
            durationTicks: half,
            velocity: 80,
            voiceId: voice2Id,
            trackId,
            tieStop: true,
          },
          {
            id: createId(),
            pitch: { step: 'A', accidental: 0, octave: 4 },
            startTick: measureTicks + half,
            durationTicks: half,
            velocity: 80,
            voiceId: voice2Id,
            trackId,
          },
        ],
      },
    ],
  };

  return baseScore('Tie Across Barline', [
    baseTrack({ measures: [measure1, measure2], id: trackId }),
  ]);
}

/** One measure, one note of each supported articulation. */
function articulationsScore(): Score {
  const trackId = createId();
  const measureTicks = measureDurationTicks(FOUR_FOUR, PPQ);
  const q = ticksFor('quarter', PPQ);
  const voiceId = createId();
  const articulations: NonNullable<NoteEvent['articulation']>[] = [
    'staccato',
    'accent',
    'tenuto',
    'marcato',
  ];

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

  return baseScore('Articulations', [
    baseTrack({ measures: [measure], id: trackId }),
  ]);
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

  const measures: Measure[] = [0, 1].map(measureIndex => {
    const voiceId = createId();
    const [step0] = pitches[0];
    const events: NoteEvent[] = [
      {
        id: createId(),
        pitch: {
          step: step0 as NoteEvent['pitch']['step'],
          accidental: 0,
          octave: 4,
        },
        startTick: measureIndex * measureTicks,
        durationTicks: dottedQuarter,
        velocity: 80,
        voiceId,
        trackId,
      },
      ...[1, 2, 3].map((i): NoteEvent => ({
        id: createId(),
        pitch: {
          step: pitches[i][0] as NoteEvent['pitch']['step'],
          accidental: 0,
          octave: pitches[i][1],
        },
        startTick:
          measureIndex * measureTicks + dottedQuarter + (i - 1) * eighth,
        durationTicks: eighth,
        velocity: 80,
        voiceId,
        trackId,
      })),
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
      expect(importedTrack.measures.map(m => m.timeSignature)).toEqual(
        track.measures.map(m => m.timeSignature)
      );
      expect(importedTrack.measures.map(m => m.keySignature)).toEqual(
        track.measures.map(m => m.keySignature)
      );
    });
  });

  it('preserves the number of voices per measure, per track', () => {
    const source = factory();
    const { imported } = roundTrip(source);
    source.tracks.forEach((track, trackIndex) => {
      const importedTrack = imported.tracks[trackIndex];
      expect(importedTrack.measures.map(m => m.voices.length)).toEqual(
        track.measures.map(m => m.voices.length)
      );
    });
  });

  it('produces a score with zero validateScore errors', () => {
    const { imported } = roundTrip(factory());
    const errors = validateScore(imported).filter(
      issue => issue.severity === 'error'
    );
    expect(errors).toEqual([]);
  });

  it("imports without warnings for this adapter's own clean export", () => {
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
    imported.tracks[0].measures.forEach(measure => {
      const notes = measure.voices[0].events.filter(isNoteEvent);
      expect(notes).toHaveLength(3);
      expect(new Set(notes.map(n => n.startTick)).size).toBe(1);
    });
  });
});

describe('dynamics round-trip', () => {
  /** Twinkle with markings on two notes, so "until the next one" is exercised. */
  function marked(): Score {
    const score = twinkleScore();
    return {
      ...score,
      tracks: score.tracks.map(track => ({
        ...track,
        measures: track.measures.map((m, mi) => ({
          ...m,
          voices: m.voices.map(v => ({
            ...v,
            events: v.events.map((e, i) => {
              if (!isNoteEvent(e)) return e;
              if (mi === 0 && i === 0) return { ...e, dynamic: 'pp' as const };
              if (mi === 2 && i === 0) return { ...e, dynamic: 'ff' as const };
              return e;
            }),
          })),
        })),
      })),
    };
  }

  it('survives export and import on the notes that carried it', () => {
    const { imported, warnings } = roundTrip(marked());
    const notes = allNotes(imported).filter(isNoteEvent);
    const withDynamics = notes.filter(n => n.dynamic);

    expect(warnings).toEqual([]);
    expect(withDynamics.map(n => n.dynamic)).toEqual(['pp', 'ff']);
  });

  it('does not spread the marking onto every note', () => {
    // A dynamic marks where a level begins. Writing one under every notehead
    // is what the "in force until the next" rule exists to avoid.
    const { imported } = roundTrip(marked());
    const notes = allNotes(imported).filter(isNoteEvent);
    expect(notes.length).toBeGreaterThan(4);
    expect(notes.filter(n => n.dynamic)).toHaveLength(2);
  });

  it('leaves an unmarked score unmarked', () => {
    const { imported } = roundTrip(twinkleScore());
    expect(
      allNotes(imported)
        .filter(isNoteEvent)
        .every(n => !n.dynamic)
    ).toBe(true);
  });
});

describe('slurs round-trip', () => {
  it('survives export and import on the notes that carried it', () => {
    const score = twinkleScore();
    const notes = allNotes(score).filter(isNoteEvent).slice(0, 4);
    const slurred = toggleSlurCommand(
      notes.map(n => n.id),
      'Slur'
    ).execute(score);

    const { imported, warnings } = roundTrip(slurred);
    const after = allNotes(imported).filter(isNoteEvent);

    expect(warnings).toEqual([]);
    expect(after.filter(n => n.slurStart)).toHaveLength(1);
    expect(after.filter(n => n.slurStop)).toHaveLength(1);
    expect(after.findIndex(n => n.slurStart)).toBeLessThan(
      after.findIndex(n => n.slurStop)
    );
  });

  it('no longer warns that a slur is unsupported', () => {
    // The importer used to report every <slur> as an unsupported notation.
    const score = twinkleScore();
    const ids = allNotes(score)
      .filter(isNoteEvent)
      .slice(0, 3)
      .map(n => n.id);
    const { warnings } = roundTrip(
      toggleSlurCommand(ids, 'Slur').execute(score)
    );
    expect(warnings.join(' ')).not.toMatch(/slur/i);
  });
});

describe('lyrics round-trip', () => {
  /** Twinkle's first three notes given a hyphenated word plus a whole one. */
  function sung(): Score {
    const score = twinkleScore();
    const notes = allNotes(score).filter(isNoteEvent).slice(0, 3);
    let result = score;
    const words: Array<[string, 'begin' | 'end' | undefined]> = [
      ['twin', 'begin'],
      ['kle', 'end'],
      ['star', undefined],
    ];
    notes.forEach((note, i) => {
      const [text, syllabic] = words[i];
      result = setLyricCommand(
        note.id,
        { text, ...(syllabic ? { syllabic } : {}) },
        'Lyric'
      ).execute(result);
    });
    return result;
  }

  it('survives export and import, syllable joins included', () => {
    const { imported, warnings } = roundTrip(sung());
    const notes = allNotes(imported).filter(isNoteEvent);

    expect(warnings).toEqual([]);
    expect(notes[0].lyric).toEqual({ text: 'twin', syllabic: 'begin' });
    expect(notes[1].lyric).toEqual({ text: 'kle', syllabic: 'end' });
    expect(notes[2].lyric).toEqual({ text: 'star' });
  });

  it('leaves an unsung score unsung', () => {
    const { imported } = roundTrip(twinkleScore());
    expect(
      allNotes(imported)
        .filter(isNoteEvent)
        .every(n => !n.lyric)
    ).toBe(true);
  });
});

describe('tuplets round-trip', () => {
  /** A bar whose first beat is a triplet of eighths. */
  function withTriplet(): Score {
    const score = twinkleScore();
    const tripletEighth = ticksFor('triplet-eighth', score.ppq);
    const quarter = ticksFor('quarter', score.ppq);
    const measure = score.tracks[0].measures[0];
    const pitch = { step: 'C' as const, accidental: 0 as const, octave: 4 };

    return {
      ...score,
      tracks: score.tracks.map((track, ti) =>
        ti !== 0
          ? track
          : {
              ...track,
              measures: track.measures.map((m, mi) =>
                mi !== 0
                  ? m
                  : {
                      ...m,
                      voices: m.voices.map((v, vi) =>
                        vi !== 0
                          ? v
                          : {
                              ...v,
                              events: [
                                ...[0, 1, 2].map(i => ({
                                  id: `trip-${i}`,
                                  pitch,
                                  startTick:
                                    measure.startTick + i * tripletEighth,
                                  durationTicks: tripletEighth,
                                  velocity: 80,
                                  voiceId: v.id,
                                  trackId: track.id,
                                })),
                                ...[0, 1, 2].map(i => ({
                                  id: `rest-${i}`,
                                  startTick:
                                    measure.startTick + quarter * (i + 1),
                                  durationTicks: quarter,
                                  voiceId: v.id,
                                  trackId: track.id,
                                })),
                              ],
                            }
                      ),
                    }
              ),
            }
      ),
    };
  }

  it('writes the scaling and the bracket, and reads them back', () => {
    const source = withTriplet();
    const xml = exportMusicXml(source);

    expect(xml).toContain('<actual-notes>3</actual-notes>');
    expect(xml).toContain('<tuplet type="start" number="1"/>');
    expect(xml).toContain('<tuplet type="stop" number="1"/>');

    const { imported, warnings } = roundTrip(source);
    const first = allNotes(imported).filter(isNoteEvent)[0];
    // Printed so a surprise warning names itself rather than showing as a
    // bare array length.
    expect(warnings.join(' | ')).toBe('');
    expect(first.durationTicks).toBe(ticksFor('triplet-eighth', imported.ppq));
  });

  it('says nothing about tuplets for an ordinary bar', () => {
    expect(exportMusicXml(twinkleScore())).not.toContain('<time-modification>');
  });
});

describe('grace notes round-trip', () => {
  it('survives export and import, attached to the same principal', () => {
    const base = twinkleScore();
    const voice = base.tracks[0].measures[0].voices[0];
    const [first, second] = voice.events.filter(isNoteEvent);
    const source = toGraceNoteCommand(first.id, 'Grace').execute(base);

    const xml = exportMusicXml(source);
    expect(xml).toContain('<grace slash="yes"/>');

    const { imported, warnings } = roundTrip(source);
    const notes = allNotes(imported).filter(isNoteEvent);
    const ornamented = notes.filter(n => n.graceNotes?.length);

    expect(warnings).toEqual([]);
    expect(ornamented).toHaveLength(1);
    expect(ornamented[0].graceNotes?.[0].pitch.step).toBe(first.pitch.step);
    expect(second).toBeDefined();
  });

  it('writes no grace element for an unornamented score', () => {
    expect(exportMusicXml(twinkleScore())).not.toContain('<grace');
  });
});

describe('chord symbols round-trip', () => {
  /** Twinkle with a chord change on each of its first three notes. */
  function leadSheet(): Score {
    const base = twinkleScore();
    const notes = allNotes(base).filter(isNoteEvent).slice(0, 3);
    const symbols = ['C', 'F#m7', 'Bb7#11'];
    return notes.reduce(
      (score, note, i) =>
        setChordSymbolCommand(note.id, symbols[i], 'Chord').execute(score),
      base
    );
  }

  it('survives export and import, dialect and all', () => {
    // The typed text is what round-trips — not a classification of it.
    const { imported, warnings } = roundTrip(leadSheet());
    const symbols = allNotes(imported)
      .filter(isNoteEvent)
      .map(n => n.chordSymbol)
      .filter(Boolean);

    expect(warnings).toEqual([]);
    expect(symbols).toEqual(['C', 'F#m7', 'Bb7#11']);
  });

  it('writes a harmony element before its note', () => {
    const xml = exportMusicXml(leadSheet());
    expect(xml).toContain('<root-step>F</root-step>');
    expect(xml).toContain('<root-alter>1</root-alter>');
    expect(xml.indexOf('<harmony')).toBeLessThan(xml.indexOf('<note>'));
  });

  it('writes no harmony for a score without chords', () => {
    expect(exportMusicXml(twinkleScore())).not.toContain('<harmony');
  });
});

describe('repeats and endings round-trip', () => {
  /** Bars 1–4 repeated, with a first and second ending on bars 3 and 4. */
  function repeated(): Score {
    const base = twoTrackScore();
    const m = base.tracks[0].measures;
    let score = changeRepeatsCommand(
      m[0].id,
      { repeatStart: true },
      'R'
    ).execute(base);
    score = changeRepeatsCommand(
      score.tracks[0].measures[2].id,
      { endingNumbers: [1], repeatEnd: true },
      'R'
    ).execute(score);
    score = changeRepeatsCommand(
      score.tracks[0].measures[3].id,
      { endingNumbers: [2] },
      'R'
    ).execute(score);
    return score;
  }

  it('writes the barlines on the right sides', () => {
    const xml = exportMusicXml(repeated());
    expect(xml).toContain('<repeat direction="forward"/>');
    expect(xml).toContain('<repeat direction="backward"/>');
    expect(xml).toContain('<ending number="1" type="start"/>');
    expect(xml).toContain('<ending number="1" type="stop"/>');
  });

  it('survives export and import on the same bars', () => {
    const { imported, warnings } = roundTrip(repeated());
    const bars = imported.tracks[0].measures;

    expect(warnings).toEqual([]);
    expect(bars[0].repeatStart).toBe(true);
    expect(bars[2].repeatEnd).toBe(true);
    expect(bars[2].endingNumbers).toEqual([1]);
    expect(bars[3].endingNumbers).toEqual([2]);
  });

  it('keeps every track in step, so the parts agree', () => {
    const { imported } = roundTrip(repeated());
    expect(imported.tracks.every(t => t.measures[0].repeatStart === true)).toBe(
      true
    );
  });

  it('writes no barline element for a score without repeats', () => {
    expect(exportMusicXml(twoTrackScore())).not.toContain('<repeat ');
  });
});
