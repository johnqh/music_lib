import { describe, expect, it } from 'vitest';
import { Accidental, Stem, Voice } from 'vexflow';
import type { StaveNote } from 'vexflow';
import {
  CUE_GLYPH_SCALE,
  buildMeasureContent,
  buildTies,
} from './measure-content.js';
import type { Channel } from './measure-content.js';
import type { MeasureLayout } from './layout.js';
import {
  buildVoiceContent,
  groupSimultaneous,
  keySignatureToVexSpec,
} from './convert.js';
import type { MusicalEvent } from '@sudobility/music_types';
import type { DisplayGroup } from './display-timing.js';
import type { NoteMeta } from './convert.js';
import type {
  KeySignature,
  Measure,
  NoteEvent,
  Pitch,
  Track,
} from '@sudobility/music_types';
import { ticksFor } from '../../domain/time/ticks.js';

/**
 * The recorded timing of `events`, as display groups. These tests are about
 * turning a duration into glyphs, not about deciding what that duration should
 * be — `display-timing.test.ts` covers that — so each group keeps the duration
 * it was written with.
 */
function recorded(events: MusicalEvent[]): DisplayGroup[] {
  return groupSimultaneous(events).map(group => ({
    events: group,
    durationTicks: group[0].durationTicks,
  }));
}

function pitch(
  step: Pitch['step'],
  accidental: Pitch['accidental'],
  octave: number
): Pitch {
  return { step, accidental, octave };
}

/** A single-note (non-chord) channel entry, built the same way buildMeasureContent does. */
function channelEntryFor(events: NoteEvent[]): {
  note: StaveNote;
  meta: NoteMeta;
} {
  const { notes, metas } = buildVoiceContent(recorded(events), 480);
  return { note: notes[0], meta: metas[0] };
}

describe('buildTies (finding 1: pitch-matched chord ties, not array adjacency)', () => {
  it('ties only the one chord member that actually ties forward, on the correct key indices', () => {
    const quarter = ticksFor('quarter', 480);
    // Measure 1 chord: C4 (ties forward), E4 (does not), G4 (does not).
    const chordA = channelEntryFor([
      {
        id: 'a-c',
        pitch: pitch('C', 0, 4),
        startTick: 0,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
        tieStart: true,
      },
      {
        id: 'a-e',
        pitch: pitch('E', 0, 4),
        startTick: 0,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
      },
      {
        id: 'a-g',
        pitch: pitch('G', 0, 4),
        startTick: 0,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
      },
    ]);
    // Measure 2 chord: C4 (receives the tie), F4, A4 — different pitches
    // than measure 1's E4/G4, and NOT flagged tieStop, so array-index
    // matching (old behavior) would have wrongly tied E4->F4 and G4->A4
    // too, on top of getting C4 right only by coincidence of index 0.
    const chordB = channelEntryFor([
      {
        id: 'b-c',
        pitch: pitch('C', 0, 4),
        startTick: quarter,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
        tieStop: true,
      },
      {
        id: 'b-f',
        pitch: pitch('F', 0, 4),
        startTick: quarter,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
      },
      {
        id: 'b-a',
        pitch: pitch('A', 0, 4),
        startTick: quarter,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
      },
    ]);
    const channel: Channel = [chordA, chordB];

    const ties = buildTies(channel);
    expect(ties).toHaveLength(1);
    const { first_indices, last_indices } = ties[0].getNotes();
    expect(first_indices).toEqual([0]); // C4 is index 0 in chordA's keys
    expect(last_indices).toEqual([0]); // C4 is index 0 in chordB's keys too (coincidentally), but chosen by pitch match
  });

  it('produces no tie when the flagged pitches do not actually match between the two notes', () => {
    const quarter = ticksFor('quarter', 480);
    const a = channelEntryFor([
      {
        id: 'a',
        pitch: pitch('C', 0, 4),
        startTick: 0,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
        tieStart: true,
      },
    ]);
    // tieStop is set, but the pitch is different (D4 vs C4) — e.g. corrupt
    // data, or two coincidentally-adjacent unrelated notes; must not tie.
    const b = channelEntryFor([
      {
        id: 'b',
        pitch: pitch('D', 0, 4),
        startTick: quarter,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
        tieStop: true,
      },
    ]);
    const ties = buildTies([a, b]);
    expect(ties).toHaveLength(0);
  });

  it('ties every matching member of an all-tied chord (all pitches identical)', () => {
    const half = ticksFor('half', 480);
    const a = channelEntryFor([
      {
        id: 'a-c',
        pitch: pitch('C', 0, 4),
        startTick: 0,
        durationTicks: half,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
        tieStart: true,
      },
      {
        id: 'a-e',
        pitch: pitch('E', 0, 4),
        startTick: 0,
        durationTicks: half,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
        tieStart: true,
      },
    ]);
    const b = channelEntryFor([
      {
        id: 'b-c',
        pitch: pitch('C', 0, 4),
        startTick: half,
        durationTicks: half,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
        tieStop: true,
      },
      {
        id: 'b-e',
        pitch: pitch('E', 0, 4),
        startTick: half,
        durationTicks: half,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
        tieStop: true,
      },
    ]);
    const ties = buildTies([a, b]);
    expect(ties).toHaveLength(1);
    const { first_indices, last_indices } = ties[0].getNotes();
    expect(first_indices).toEqual([0, 1]);
    expect(last_indices).toEqual([0, 1]);
  });
});

describe('key-signature-aware accidentals (finding 3)', () => {
  /** Mirrors exactly what buildMeasureContent does: build notes, then let VexFlow decide accidental glyphs from the key signature. */
  function accidentalCategoriesFor(
    events: NoteEvent[],
    keySignature: KeySignature
  ): string[][] {
    const { notes } = buildVoiceContent(recorded(events), 480);
    const voice = new Voice({ num_beats: 4, beat_value: 4 }).setMode(
      Voice.Mode.SOFT
    );
    voice.addTickables(notes);
    Accidental.applyAccidentals([voice], keySignatureToVexSpec(keySignature));
    return notes.map(n =>
      n
        .getModifiers()
        .filter(m => m.getCategory() === 'Accidental')
        .map(() => 'Accidental')
    );
  }

  const quarter = ticksFor('quarter', 480);
  const gMajor: KeySignature = { fifths: 1, mode: 'major' };
  const cMajor: KeySignature = { fifths: 0, mode: 'major' };

  it('draws no accidental for an F# in G major (implied by the key signature)', () => {
    const events: NoteEvent[] = [
      {
        id: 'n',
        pitch: pitch('F', 1, 4),
        startTick: 0,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
      },
    ];
    const [categories] = accidentalCategoriesFor(events, gMajor);
    expect(categories).toEqual([]);
  });

  it('draws a natural sign for an F-natural in G major (contradicts the key signature)', () => {
    const events: NoteEvent[] = [
      {
        id: 'n',
        pitch: pitch('F', 0, 4),
        startTick: 0,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
      },
    ];
    const [categories] = accidentalCategoriesFor(events, gMajor);
    expect(categories).toEqual(['Accidental']);
  });

  it('draws an accidental for a chromatic note in C major', () => {
    const events: NoteEvent[] = [
      {
        id: 'n',
        pitch: pitch('C', 1, 4),
        startTick: 0,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
      },
    ];
    const [categories] = accidentalCategoriesFor(events, cMajor);
    expect(categories).toEqual(['Accidental']);
  });

  it('draws no accidental for an in-key natural note in C major', () => {
    const events: NoteEvent[] = [
      {
        id: 'n',
        pitch: pitch('D', 0, 4),
        startTick: 0,
        durationTicks: quarter,
        velocity: 80,
        voiceId: 'v',
        trackId: 't',
      },
    ];
    const [categories] = accidentalCategoriesFor(events, cMajor);
    expect(categories).toEqual([]);
  });
});

describe('cue notes', () => {
  const quarter = ticksFor('quarter', 480);
  const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };
  const FOUR_FOUR = { numerator: 4, denominator: 4 };

  /** One quarter note, as a cue would carry it. */
  const cueEvents: NoteEvent[] = [
    {
      id: 'c1',
      pitch: pitch('C', 0, 5),
      startTick: 0,
      durationTicks: quarter,
      velocity: 80,
      voiceId: 'v',
      trackId: 't',
    },
  ];

  /** A one-voice measure holding a whole-bar rest, optionally carrying a cue. */
  function measureWith(cue?: { label: string; events: NoteEvent[] }): Measure {
    return {
      id: 'm1',
      index: 0,
      startTick: 0,
      durationTicks: 1920,
      timeSignature: FOUR_FOUR,
      keySignature: C_MAJOR,
      voices: [
        {
          id: 'v1',
          name: 'Voice 1',
          events: [
            {
              id: 'r1',
              startTick: 0,
              durationTicks: 1920,
              voiceId: 'v1',
              trackId: 't1',
            },
          ],
        },
      ],
      ...(cue ? { cue } : {}),
    } as Measure;
  }

  const track = {
    id: 't1',
    name: 'Solo',
    instrumentName: 'Solo',
    midiProgram: 0,
    midiChannel: 0,
    clef: 'treble' as const,
    volume: 1,
    pan: 0,
    measures: [],
  } as unknown as Track;

  const placement = {
    box: { x: 0, y: 0, width: 300, height: 100 },
    isFirstInSystem: true,
  } as unknown as MeasureLayout;

  function build(measure: Measure) {
    return buildMeasureContent(
      measure,
      track,
      placement,
      undefined,
      480,
      new Map(),
      []
    );
  }

  it('draws the cue at a reduced glyph scale', () => {
    const { voices } = build(
      measureWith({ label: 'Flute', events: cueEvents })
    );
    const tickables = voices[0].getTickables() as StaveNote[];
    expect(tickables[0].render_options.glyph_font_scale).toBe(CUE_GLYPH_SCALE);
  });

  it('draws no whole-bar rest in a cue bar', () => {
    // Two objects competing for one bar collide, and the canvas layout has no
    // collision avoidance. Small notes under an instrument name already read
    // as "not yours".
    const plain = build(measureWith());
    const cued = build(measureWith({ label: 'Flute', events: cueEvents }));

    const isRest = (n: StaveNote) => n.getNoteType() === 'r';
    expect((plain.voices[0].getTickables() as StaveNote[]).some(isRest)).toBe(
      true
    );
    expect((cued.voices[0].getTickables() as StaveNote[]).some(isRest)).toBe(
      false
    );
  });

  it('does not register cue notes for ties or hit-testing', () => {
    // A cue note is not the player's note: it must never tie to one, and must
    // never answer a hit test.
    const channels = new Map();
    const metas: NoteMeta[] = [];
    buildMeasureContent(
      measureWith({ label: 'Flute', events: cueEvents }),
      track,
      placement,
      undefined,
      480,
      channels,
      metas
    );
    expect(channels.size).toBe(0);
    expect(metas).toHaveLength(0);
  });
});

describe('two voices on one stave', () => {
  const stemTrack = {
    id: 't1',
    name: 'Piano',
    instrumentName: 'Piano',
    midiProgram: 0,
    midiChannel: 0,
    clef: 'treble' as const,
    volume: 1,
    pan: 0,
    measures: [],
  } as unknown as Track;

  const stemPlacement = {
    box: { x: 0, y: 0, width: 300, height: 100 },
    isFirstInSystem: true,
  } as unknown as MeasureLayout;

  /** A bar of quarter notes in `voiceCount` voices, spread across the stave. */
  function measureWithVoices(voiceCount: number): Measure {
    const quarter = ticksFor('quarter', 480);
    const octaves = [5, 4];
    return {
      id: 'm1',
      index: 0,
      startTick: 0,
      durationTicks: 1920,
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: { fifths: 0, mode: 'major' },
      voices: Array.from({ length: voiceCount }, (_, vi) => ({
        id: `v${vi}`,
        name: `Voice ${vi + 1}`,
        events: ['C', 'E', 'G', 'B'].map((step, i) => ({
          id: `n${vi}-${i}`,
          pitch: {
            step,
            accidental: 0,
            // One voice: straddle the middle line, so VexFlow's own
            // per-position choice produces both directions and the assertion
            // is about the choice rather than about where the notes sit.
            octave: voiceCount === 1 ? (i < 2 ? 4 : 5) : (octaves[vi] ?? 4),
          },
          startTick: i * quarter,
          durationTicks: quarter,
          velocity: 80,
          voiceId: `v${vi}`,
          trackId: 't1',
        })),
      })),
    } as unknown as Measure;
  }

  function stemDirections(measure: Measure): number[][] {
    const { voices } = buildMeasureContent(
      measure,
      stemTrack,
      stemPlacement,
      undefined,
      480,
      new Map(),
      []
    );
    return voices.map(v =>
      v
        .getTickables()
        .filter(t => typeof (t as StaveNote).getStemDirection === 'function')
        .map(t => (t as StaveNote).getStemDirection())
    );
  }

  it('stems the upper voice up and the lower voice down', () => {
    // Without this the two draw identically, and there is no way to see which
    // line is being edited — the whole reason a second voice exists.
    const [upper, lower] = stemDirections(measureWithVoices(2));
    expect(upper.length).toBeGreaterThan(0);
    expect(lower.length).toBeGreaterThan(0);
    expect(upper.every(d => d === Stem.UP)).toBe(true);
    expect(lower.every(d => d === Stem.DOWN)).toBe(true);
  });

  it('leaves a single voice to VexFlow, which stems by staff position', () => {
    // An engraver points a stem by where the note sits; forcing a direction on
    // a one-voice stave would point half of them the wrong way.
    const [only] = stemDirections(measureWithVoices(1));
    expect(new Set(only).size).toBeGreaterThan(1);
  });
});
