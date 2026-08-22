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
import { createId } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import type { Measure, NoteEvent, Score, Track } from '@sudobility/music_types';
import { pitchToMidi } from '@sudobility/music_types';
import { allNotes } from '@sudobility/music_types';
import {
  changeArticulationCommand,
  changeOrnamentCommand,
  setChordSymbolCommand,
  setLyricCommand,
  toGraceNoteCommand,
  setFingeringCommand,
  toggleArpeggiateCommand,
  toggleGlissandoCommand,
  toggleOttavaCommand,
  toggleFermataCommand,
  toggleHairpinCommand,
  toggleSlurCommand,
} from '@sudobility/music_types';
import {
  changeBarlineCommand,
  changeMeasureClefCommand,
  changeRepeatsCommand,
  setPickupCommand,
} from '@sudobility/music_types';
import { barNumberAt } from '@sudobility/music_types';
import { repeatPlayOrder } from '@sudobility/music_types';
import { measureDurationTicks, ticksFor } from '@sudobility/music_types';
import { validateScore } from '@sudobility/music_types';
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

describe('fermatas round-trip', () => {
  /** Twinkle with a fermata on its first and last note. */
  function paused() {
    const score = twinkleScore();
    const notes = allNotes(score).filter(isNoteEvent);
    return toggleFermataCommand(
      [notes[0].id, notes[notes.length - 1].id],
      'Fermata'
    ).execute(score);
  }

  it('survives export and import on the notes that carried it', () => {
    const { imported, warnings } = roundTrip(paused());
    const after = allNotes(imported).filter(isNoteEvent);

    expect(warnings).toEqual([]);
    expect(after.filter(n => n.fermata)).toHaveLength(2);
    expect(after[0].fermata).toBe(true);
    expect(after[after.length - 1].fermata).toBe(true);
  });

  it('does not spread onto the notes between', () => {
    const { imported } = roundTrip(paused());
    const after = allNotes(imported).filter(isNoteEvent);
    expect(after.length).toBeGreaterThan(4);
    expect(after.slice(1, -1).some(n => n.fermata)).toBe(false);
  });

  it('no longer warns that a fermata is unsupported', () => {
    // Before this, <fermata> was reported as an unsupported notation and the
    // pause was dropped — so importing a chorale lost every hold in it.
    const { warnings } = roundTrip(paused());
    expect(warnings.join(' ')).not.toMatch(/fermata/i);
  });

  it('leaves an unmarked score unmarked', () => {
    const { imported } = roundTrip(twinkleScore());
    expect(
      allNotes(imported)
        .filter(isNoteEvent)
        .every(n => !n.fermata)
    ).toBe(true);
  });

  it('survives alongside an articulation on the same note', () => {
    // The reason it is its own field: MusicXML keeps <fermata> outside
    // <articulations> too, so both have to come back.
    const score = twinkleScore();
    const id = allNotes(score).filter(isNoteEvent)[0].id;
    const both = toggleFermataCommand([id], 'Fermata').execute(
      changeArticulationCommand([id], 'accent', 'Accent').execute(score)
    );

    const { imported, warnings } = roundTrip(both);
    const after = allNotes(imported).filter(isNoteEvent)[0];

    expect(warnings).toEqual([]);
    expect(after.fermata).toBe(true);
    expect(after.articulation).toBe('accent');
  });
});

describe('ornaments round-trip', () => {
  const SIGNS = ['trill', 'mordent', 'inverted-mordent', 'turn'] as const;

  it.each(SIGNS)('survives export and import: %s', sign => {
    const score = twinkleScore();
    const id = allNotes(score).filter(isNoteEvent)[0].id;
    const marked = changeOrnamentCommand([id], sign, 'Ornament').execute(score);

    const { imported, warnings } = roundTrip(marked);
    const after = allNotes(imported).filter(isNoteEvent)[0];

    expect(warnings).toEqual([]);
    expect(after.ornament).toBe(sign);
  });

  it('keeps a mordent distinct from an inverted mordent', () => {
    // They are different signs, and the two libraries name them opposite ways
    // round — a mapping error here would silently swap them on every import.
    const score = twinkleScore();
    const id = allNotes(score).filter(isNoteEvent)[0].id;

    const asMordent = roundTrip(
      changeOrnamentCommand([id], 'mordent', 'Ornament').execute(score)
    ).imported;
    const asInverted = roundTrip(
      changeOrnamentCommand([id], 'inverted-mordent', 'Ornament').execute(score)
    ).imported;

    expect(allNotes(asMordent).filter(isNoteEvent)[0].ornament).toBe('mordent');
    expect(allNotes(asInverted).filter(isNoteEvent)[0].ornament).toBe(
      'inverted-mordent'
    );
  });

  it('no longer warns that ornaments are unsupported', () => {
    // Before this, <ornaments> raised "Ornaments are not supported and were
    // ignored" and every trill in an imported score was lost.
    const score = twinkleScore();
    const id = allNotes(score).filter(isNoteEvent)[0].id;
    const { warnings } = roundTrip(
      changeOrnamentCommand([id], 'trill', 'Ornament').execute(score)
    );
    expect(warnings.join(' ')).not.toMatch(/ornament/i);
  });

  it('leaves an unmarked score unmarked', () => {
    const { imported } = roundTrip(twinkleScore());
    expect(
      allNotes(imported)
        .filter(isNoteEvent)
        .every(n => !n.ornament)
    ).toBe(true);
  });

  it('carries an ornament and a fermata on the same note', () => {
    const score = twinkleScore();
    const id = allNotes(score).filter(isNoteEvent)[0].id;
    const both = toggleFermataCommand([id], 'Fermata').execute(
      changeOrnamentCommand([id], 'trill', 'Ornament').execute(score)
    );

    const { imported, warnings } = roundTrip(both);
    const after = allNotes(imported).filter(isNoteEvent)[0];

    expect(warnings).toEqual([]);
    expect(after.ornament).toBe('trill');
    expect(after.fermata).toBe(true);
  });
});

describe('clef changes round-trip', () => {
  it('survives export and import on the bar that carries it', () => {
    // Before this the change was dropped with a warning and the whole part
    // kept one clef — which makes a piano left hand unreadable.
    const score = twinkleScore();
    const trackId = score.tracks[0].id;
    const changed = changeMeasureClefCommand(
      trackId,
      2,
      'bass',
      'Clef'
    ).execute(score);

    const { imported, warnings } = roundTrip(changed);
    const measures = imported.tracks[0].measures;

    expect(warnings).toEqual([]);
    expect(imported.tracks[0].clef).toBe('treble');
    expect(measures[2].clef).toBe('bass');
    expect(measures[1].clef).toBeUndefined();
  });

  it('keeps the part opening in its original clef', () => {
    // `Track.clef` is the clef the part *opened* in. Letting it follow the
    // last change made an imported part adopt whatever clef it ended in.
    const score = twinkleScore();
    const changed = changeMeasureClefCommand(
      score.tracks[0].id,
      1,
      'bass',
      'Clef'
    ).execute(score);

    expect(roundTrip(changed).imported.tracks[0].clef).toBe('treble');
  });

  it('round-trips two changes, not just the first', () => {
    const score = twinkleScore();
    const trackId = score.tracks[0].id;
    const changed = changeMeasureClefCommand(
      trackId,
      3,
      'treble',
      'Clef'
    ).execute(
      changeMeasureClefCommand(trackId, 1, 'bass', 'Clef').execute(score)
    );

    const measures = roundTrip(changed).imported.tracks[0].measures;
    expect(measures[1].clef).toBe('bass');
    expect(measures[3].clef).toBe('treble');
  });

  it('leaves a score with no clef change unmarked', () => {
    const { imported } = roundTrip(twinkleScore());
    expect(imported.tracks[0].measures.every(m => m.clef === undefined)).toBe(
      true
    );
  });
});

describe('pickup bars round-trip', () => {
  it('survives export and import, and does not become bar 1', () => {
    const score = setPickupCommand(1, 'Pickup').execute(twinkleScore());
    const { imported, warnings } = roundTrip(score);
    const measures = imported.tracks[0].measures;

    expect(warnings).toEqual([]);
    expect(measures[0].pickup).toBe(true);
    expect(measures[1].pickup).toBeUndefined();
    expect(barNumberAt(measures, 0)).toBeNull();
    expect(barNumberAt(measures, 1)).toBe(1);
  });

  it('keeps the pickup short', () => {
    const score = setPickupCommand(1, 'Pickup').execute(twinkleScore());
    const measures = roundTrip(score).imported.tracks[0].measures;
    expect(measures[0].durationTicks).toBeLessThan(measures[1].durationTicks);
  });

  it('leaves an ordinary score with no implicit bar', () => {
    const measures = roundTrip(twinkleScore()).imported.tracks[0].measures;
    expect(measures.every(m => m.pickup === undefined)).toBe(true);
    expect(barNumberAt(measures, 0)).toBe(1);
  });
});

describe('hairpins and arpeggios round-trip', () => {
  /** Twinkle with a crescendo across its first four notes. */
  function withHairpin(kind: 'crescendo' | 'diminuendo' = 'crescendo') {
    const score = twinkleScore();
    const ids = allNotes(score)
      .filter(isNoteEvent)
      .slice(0, 4)
      .map(n => n.id);
    return toggleHairpinCommand(ids, kind, 'Hairpin').execute(score);
  }

  it('survives export and import on the notes that carried it', () => {
    const { imported, warnings } = roundTrip(withHairpin());
    const after = allNotes(imported).filter(isNoteEvent);

    expect(warnings).toEqual([]);
    expect(after.filter(n => n.hairpinStart).length).toBe(1);
    expect(after.filter(n => n.hairpinStop).length).toBe(1);
    expect(after.find(n => n.hairpinStart)?.hairpinStart).toBe('crescendo');
  });

  it('keeps the direction it was written in', () => {
    const after = allNotes(
      roundTrip(withHairpin('diminuendo')).imported
    ).filter(isNoteEvent);
    expect(after.find(n => n.hairpinStart)?.hairpinStart).toBe('diminuendo');
  });

  it('closes the wedge after the note it covers, not before it', () => {
    // A <direction> sits at a point in the bar, so a stop written ahead of the
    // closing note would end the wedge at that note's onset and leave it
    // outside. The open must come before the close in the note order.
    const after = allNotes(roundTrip(withHairpin()).imported).filter(
      isNoteEvent
    );
    expect(after.findIndex(n => n.hairpinStart)).toBeLessThan(
      after.findIndex(n => n.hairpinStop)
    );
  });

  it('round-trips a rolled chord', () => {
    const score = chordScore();
    const ids = allNotes(score)
      .filter(isNoteEvent)
      .slice(0, 3)
      .map(n => n.id);
    const rolled = toggleArpeggiateCommand(ids, 'Arpeggiate').execute(score);

    const { imported, warnings } = roundTrip(rolled);
    expect(warnings).toEqual([]);
    expect(
      allNotes(imported)
        .filter(isNoteEvent)
        .filter(n => n.arpeggiate).length
    ).toBeGreaterThan(0);
  });

  it('leaves an unmarked score unmarked', () => {
    const after = allNotes(roundTrip(twinkleScore()).imported).filter(
      isNoteEvent
    );
    expect(
      after.every(n => !n.hairpinStart && !n.hairpinStop && !n.arpeggiate)
    ).toBe(true);
  });
});

describe('barlines round-trip', () => {
  it('survives a final barline', () => {
    const score = twinkleScore();
    const last = score.tracks[0].measures.length - 1;
    const marked = changeBarlineCommand(last, 'final', 'Barline').execute(
      score
    );

    const { imported, warnings } = roundTrip(marked);
    expect(warnings).toEqual([]);
    expect(imported.tracks[0].measures[last].barline).toBe('final');
  });

  it('survives a double barline, and tells the two apart', () => {
    const score = twinkleScore();
    const marked = changeBarlineCommand(1, 'double', 'Barline').execute(score);
    const measures = roundTrip(marked).imported.tracks[0].measures;

    expect(measures[1].barline).toBe('double');
    expect(measures[0].barline).toBeUndefined();
  });

  it('applies across every track, since parts must agree', () => {
    const score = twoTrackScore();
    const marked = changeBarlineCommand(0, 'final', 'Barline').execute(score);
    expect(marked.tracks[1].measures[0].barline).toBe('final');
  });

  it('leaves a repeat close alone rather than drawing over it', () => {
    // The `:|` is the instruction a player acts on; a double bar written over
    // it would silently remove a repeat from the performance.
    const score = twinkleScore();
    const withRepeat = changeRepeatsCommand(
      score.tracks[0].measures[1].id,
      { repeatEnd: true },
      'Repeat'
    ).execute(score);
    const marked = changeBarlineCommand(1, 'double', 'Barline').execute(
      withRepeat
    );

    const measures = roundTrip(marked).imported.tracks[0].measures;
    expect(measures[1].repeatEnd).toBe(true);
  });

  it('leaves an unmarked score with no barline styles', () => {
    const measures = roundTrip(twinkleScore()).imported.tracks[0].measures;
    expect(measures.every(m => m.barline === undefined)).toBe(true);
  });
});

describe('repeat navigation round-trips', () => {
  /** Marks bar `index` of every track, the way the commands will. */
  function mark(source: Score, index: number, patch: Partial<Measure>): Score {
    return {
      ...source,
      tracks: source.tracks.map(track => ({
        ...track,
        measures: track.measures.map((m, i) =>
          i === index ? { ...m, ...patch } : m
        ),
      })),
    };
  }

  it('carries a D.S. al Coda and every place it names', () => {
    let s = twinkleScore();
    s = mark(s, 1, { segno: true });
    s = mark(s, 2, { toCoda: true });
    s = mark(s, 3, { jump: 'dal-segno-al-coda' });
    s = mark(s, 4, { coda: true });

    const { imported, warnings } = roundTrip(s);
    const measures = imported.tracks[0].measures;

    expect(warnings).toEqual([]);
    expect(measures[1].segno).toBe(true);
    expect(measures[2].toCoda).toBe(true);
    expect(measures[3].jump).toBe('dal-segno-al-coda');
    expect(measures[4].coda).toBe(true);
  });

  it('tells D.C. al Fine apart from a plain D.C.', () => {
    // The target is read from the words beside the <sound>, so the two must
    // not collapse into each other.
    const alFine = roundTrip(
      mark(mark(twinkleScore(), 1, { fine: true }), 3, {
        jump: 'da-capo-al-fine',
      })
    ).imported.tracks[0].measures;
    const plain = roundTrip(mark(twinkleScore(), 3, { jump: 'da-capo' }))
      .imported.tracks[0].measures;

    expect(alFine[3].jump).toBe('da-capo-al-fine');
    expect(alFine[1].fine).toBe(true);
    expect(plain[3].jump).toBe('da-capo');
  });

  it('tells a dal segno apart from a da capo', () => {
    const ds = roundTrip(mark(twinkleScore(), 2, { jump: 'dal-segno' }))
      .imported.tracks[0].measures;
    expect(ds[2].jump).toBe('dal-segno');
  });

  it('leaves a score with no navigation unmarked', () => {
    const measures = roundTrip(twinkleScore()).imported.tracks[0].measures;
    expect(
      measures.every(
        m => !m.segno && !m.coda && !m.toCoda && !m.fine && !m.jump
      )
    ).toBe(true);
  });

  it('plays the imported score in the same order as the original', () => {
    // The point of the whole round trip: an exported and re-imported score
    // must perform identically.
    let s = twinkleScore();
    s = mark(s, 1, { segno: true });
    s = mark(s, 3, { jump: 'dal-segno' });

    expect(
      repeatPlayOrder(roundTrip(s).imported).map(p => p.measureIndex)
    ).toEqual(repeatPlayOrder(s).map(p => p.measureIndex));
  });
});

describe('ottava, glissando and fingering round-trip', () => {
  function firstIds(s: Score, n: number) {
    return allNotes(s)
      .filter(isNoteEvent)
      .slice(0, n)
      .map(x => x.id);
  }

  it.each(['8va', '8vb', '15ma', '15mb'] as const)(
    'carries an octave bracket: %s',
    kind => {
      const score = twinkleScore();
      const marked = toggleOttavaCommand(
        firstIds(score, 4),
        kind,
        'Ottava'
      ).execute(score);
      const { imported, warnings } = roundTrip(marked);
      const after = allNotes(imported).filter(isNoteEvent);

      expect(warnings).toEqual([]);
      expect(after.find(n => n.ottavaStart)?.ottavaStart).toBe(kind);
      expect(after.filter(n => n.ottavaStop)).toHaveLength(1);
    }
  );

  it('does not confuse an 8va with an 8vb', () => {
    // MusicXML names the direction the *notes* move, which is the opposite of
    // the sound — getting that backwards silently inverts every bracket.
    const score = twinkleScore();
    const up = roundTrip(
      toggleOttavaCommand(firstIds(score, 3), '8va', 'o').execute(score)
    ).imported;
    const down = roundTrip(
      toggleOttavaCommand(firstIds(score, 3), '8vb', 'o').execute(score)
    ).imported;

    expect(
      allNotes(up)
        .filter(isNoteEvent)
        .find(n => n.ottavaStart)?.ottavaStart
    ).toBe('8va');
    expect(
      allNotes(down)
        .filter(isNoteEvent)
        .find(n => n.ottavaStart)?.ottavaStart
    ).toBe('8vb');
  });

  it('carries a glissando between two notes', () => {
    const score = twinkleScore();
    const marked = toggleGlissandoCommand(firstIds(score, 2), 'Gliss').execute(
      score
    );
    const after = allNotes(roundTrip(marked).imported).filter(isNoteEvent);

    expect(after.filter(n => n.glissandoStart)).toHaveLength(1);
    expect(after.filter(n => n.glissandoStop)).toHaveLength(1);
  });

  it('carries fingering, including a non-numeric one', () => {
    const score = twinkleScore();
    const ids = firstIds(score, 2);
    const marked = setFingeringCommand([ids[1]], 'T', 'F').execute(
      setFingeringCommand([ids[0]], '3', 'F').execute(score)
    );
    const after = allNotes(roundTrip(marked).imported).filter(isNoteEvent);

    expect(after[0].fingering).toBe('3');
    expect(after[1].fingering).toBe('T');
  });

  it('leaves an unmarked score unmarked', () => {
    const after = allNotes(roundTrip(twinkleScore()).imported).filter(
      isNoteEvent
    );
    expect(
      after.every(n => !n.ottavaStart && !n.glissandoStart && !n.fingering)
    ).toBe(true);
  });
});
