import { describe, expect, it } from 'vitest';
import type {
  KeySignature,
  MusicalEvent,
  NoteEvent,
  Pitch,
  RestEvent,
} from '@sudobility/music_types';
import { ticksFor } from '../../domain/time/ticks.js';
import {
  buildVoiceContent,
  groupSimultaneous,
  keySignatureToVexSpec,
  pitchToVexKey,
  ticksToVexDuration,
} from './convert.js';
import type { DisplayGroup } from './display-timing.js';

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

const PPQ = 480;

function pitch(
  step: Pitch['step'],
  accidental: Pitch['accidental'],
  octave: number
): Pitch {
  return { step, accidental, octave };
}

function note(
  overrides: Partial<NoteEvent> &
    Pick<NoteEvent, 'startTick' | 'durationTicks' | 'pitch'>
): NoteEvent {
  return {
    id:
      overrides.id ??
      `note-${overrides.startTick}-${overrides.pitch.step}${overrides.pitch.octave}`,
    velocity: 80,
    voiceId: 'voice-1',
    trackId: 'track-1',
    ...overrides,
  };
}

function rest(
  overrides: Partial<RestEvent> & Pick<RestEvent, 'startTick' | 'durationTicks'>
): RestEvent {
  return {
    id: overrides.id ?? `rest-${overrides.startTick}`,
    voiceId: 'voice-1',
    trackId: 'track-1',
    ...overrides,
  };
}

describe('pitchToVexKey', () => {
  it('renders a natural pitch', () => {
    expect(pitchToVexKey(pitch('C', 0, 4))).toBe('c/4');
  });

  it('renders sharps and flats', () => {
    expect(pitchToVexKey(pitch('F', 1, 5))).toBe('f#/5');
    expect(pitchToVexKey(pitch('B', -1, 3))).toBe('bb/3');
    expect(pitchToVexKey(pitch('C', 2, 4))).toBe('c##/4');
    expect(pitchToVexKey(pitch('D', -2, 4))).toBe('dbb/4');
  });
});

describe('ticksToVexDuration', () => {
  it('maps exact named durations', () => {
    expect(ticksToVexDuration(ticksFor('quarter', PPQ), PPQ)).toEqual({
      code: 'q',
      dots: 0,
    });
    expect(ticksToVexDuration(ticksFor('eighth', PPQ), PPQ)).toEqual({
      code: '8',
      dots: 0,
    });
    expect(ticksToVexDuration(ticksFor('dotted-quarter', PPQ), PPQ)).toEqual({
      code: 'q',
      dots: 1,
    });
    expect(ticksToVexDuration(ticksFor('whole', PPQ), PPQ)).toEqual({
      code: 'w',
      dots: 0,
    });
    expect(ticksToVexDuration(ticksFor('sixteenth', PPQ), PPQ)).toEqual({
      code: '16',
      dots: 0,
    });
  });

  it('approximates a non-standard remainder to the nearest renderable duration', () => {
    // 5 ticks at ppq=480 is far smaller than a thirty-second note (15 ticks)
    // and doesn't match any named duration exactly.
    const result = ticksToVexDuration(5, PPQ);
    expect(result.code).toBe('32');
    expect(result.dots).toBe(0);
  });
});

describe('keySignatureToVexSpec', () => {
  it('maps common major/minor key signatures', () => {
    expect(keySignatureToVexSpec({ fifths: 0, mode: 'major' })).toBe('C');
    expect(keySignatureToVexSpec({ fifths: 0, mode: 'minor' })).toBe('Am');
    expect(keySignatureToVexSpec({ fifths: 2, mode: 'major' })).toBe('D');
    expect(keySignatureToVexSpec({ fifths: -2, mode: 'major' })).toBe('Bb');
    expect(keySignatureToVexSpec({ fifths: -3, mode: 'minor' })).toBe('Cm');
  });

  it('clamps out-of-range fifths', () => {
    const extreme: KeySignature = { fifths: 99, mode: 'major' };
    expect(keySignatureToVexSpec(extreme)).toBe('C#');
  });
});

describe('groupSimultaneous', () => {
  it('groups consecutive events sharing start/duration ticks', () => {
    const events: MusicalEvent[] = [
      note({ startTick: 0, durationTicks: 100, pitch: pitch('C', 0, 4) }),
      note({ startTick: 0, durationTicks: 100, pitch: pitch('E', 0, 4) }),
      rest({ startTick: 100, durationTicks: 50 }),
      note({ startTick: 150, durationTicks: 50, pitch: pitch('G', 0, 4) }),
    ];

    const groups = groupSimultaneous(events);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toHaveLength(1);
    expect(groups[2]).toHaveLength(1);
  });
});

describe('buildVoiceContent', () => {
  it('builds one StaveNote per non-chord note with matching id and duration', () => {
    const quarter = ticksFor('quarter', PPQ);
    const events: NoteEvent[] = [
      note({
        id: 'n1',
        startTick: 0,
        durationTicks: quarter,
        pitch: pitch('C', 0, 4),
      }),
      note({
        id: 'n2',
        startTick: quarter,
        durationTicks: quarter,
        pitch: pitch('D', 0, 4),
      }),
    ];

    const { notes, metas } = buildVoiceContent(recorded(events), PPQ);
    expect(notes).toHaveLength(2);
    expect(metas).toHaveLength(2);
    expect(metas[0]).toMatchObject({
      vexId: 'n1',
      eventIds: ['n1'],
      isRest: false,
    });
    expect(metas[1]).toMatchObject({
      vexId: 'n2',
      eventIds: ['n2'],
      isRest: false,
    });
    expect(notes[0].getDuration()).toBe('q');
    expect(notes[0].getKeys()).toEqual(['c/4']);
  });

  it('groups simultaneous notes into a single chord StaveNote', () => {
    const half = ticksFor('half', PPQ);
    const events: NoteEvent[] = [
      note({
        id: 'c1',
        startTick: 0,
        durationTicks: half,
        pitch: pitch('C', 0, 4),
      }),
      note({
        id: 'c2',
        startTick: 0,
        durationTicks: half,
        pitch: pitch('E', 0, 4),
      }),
      note({
        id: 'c3',
        startTick: 0,
        durationTicks: half,
        pitch: pitch('G', 0, 4),
      }),
    ];

    const { notes, metas } = buildVoiceContent(recorded(events), PPQ);
    expect(notes).toHaveLength(1);
    expect(metas).toHaveLength(1);
    expect(metas[0].eventIds).toEqual(['c1', 'c2', 'c3']);
    expect(notes[0].getKeys()).toEqual(['c/4', 'e/4', 'g/4']);
    expect(notes[0].isChord()).toBe(true);
  });

  it('renders rests using the rest type', () => {
    const events: RestEvent[] = [
      rest({ id: 'r1', startTick: 0, durationTicks: ticksFor('quarter', PPQ) }),
    ];
    const { notes, metas } = buildVoiceContent(recorded(events), PPQ);
    expect(notes).toHaveLength(1);
    expect(notes[0].isRest()).toBe(true);
    expect(metas[0].isRest).toBe(true);
    expect(metas[0].tieStart).toBe(false);
    expect(metas[0].tieStop).toBe(false);
  });

  it('decomposes a non-representable duration into tied segments', () => {
    // 5 sixteenth notes (5 * 120 = 600 ticks) isn't a single named duration;
    // decomposeDuration greedily splits it into dotted-quarter + sixteenth.
    const ticks = 5 * ticksFor('sixteenth', PPQ);
    const events: NoteEvent[] = [
      note({
        id: 'long',
        startTick: 0,
        durationTicks: ticks,
        pitch: pitch('C', 0, 4),
      }),
    ];

    const { notes, metas } = buildVoiceContent(recorded(events), PPQ);
    expect(notes.length).toBeGreaterThan(1);
    expect(metas.every(m => m.eventIds[0] === 'long')).toBe(true);
    // First segment ties forward, last segment ties backward, ids are unique.
    expect(metas[0].tieStart).toBe(true);
    expect(metas[0].tieStop).toBe(false);
    expect(metas[metas.length - 1].tieStart).toBe(false);
    expect(metas[metas.length - 1].tieStop).toBe(true);
    const ids = new Set(metas.map(m => m.vexId));
    expect(ids.size).toBe(metas.length);
  });

  it('preserves a genuine domain tie (tieStart/tieStop) on a single-segment note', () => {
    const quarter = ticksFor('quarter', PPQ);
    const events: NoteEvent[] = [
      note({
        id: 'a',
        startTick: 0,
        durationTicks: quarter,
        pitch: pitch('C', 0, 4),
        tieStart: true,
      }),
      note({
        id: 'b',
        startTick: quarter,
        durationTicks: quarter,
        pitch: pitch('C', 0, 4),
        tieStop: true,
      }),
    ];
    const { metas } = buildVoiceContent(recorded(events), PPQ);
    expect(metas[0].tieStart).toBe(true);
    expect(metas[0].tieStop).toBe(false);
    expect(metas[1].tieStart).toBe(false);
    expect(metas[1].tieStop).toBe(true);
  });

  it('attaches an articulation modifier but no accidental modifier (key-signature-aware accidentals are decided by renderer.ts)', () => {
    const events: NoteEvent[] = [
      note({
        id: 'sharp',
        startTick: 0,
        durationTicks: ticksFor('quarter', PPQ),
        pitch: pitch('F', 1, 4),
        articulation: 'staccato',
      }),
    ];
    const { notes } = buildVoiceContent(recorded(events), PPQ);
    const modifierCategories = notes[0]
      .getModifiers()
      .map(m => m.getCategory());
    expect(modifierCategories).not.toContain('Accidental');
    expect(modifierCategories).toContain('Articulation');
    // The accidental is still spelled into the key string, which is what
    // `Accidental.applyAccidentals` (called in renderer.ts) reads.
    expect(notes[0].getKeys()).toEqual(['f#/4']);
  });

  it('builds per-key tie metadata parallel to a chord, keyed by pitch', () => {
    const half = ticksFor('half', PPQ);
    const events: NoteEvent[] = [
      note({
        id: 'c1',
        startTick: 0,
        durationTicks: half,
        pitch: pitch('C', 0, 4),
        tieStart: true,
      }),
      note({
        id: 'c2',
        startTick: 0,
        durationTicks: half,
        pitch: pitch('E', 0, 4),
      }),
      note({
        id: 'c3',
        startTick: 0,
        durationTicks: half,
        pitch: pitch('G', 0, 4),
        tieStart: true,
      }),
    ];
    const { metas } = buildVoiceContent(recorded(events), PPQ);
    expect(metas[0].keyTies).toEqual([
      { pitch: pitch('C', 0, 4), tieStart: true, tieStop: false },
      { pitch: pitch('E', 0, 4), tieStart: false, tieStop: false },
      { pitch: pitch('G', 0, 4), tieStart: true, tieStop: false },
    ]);
    // Whole-note flags are an OR over the per-key state (a cheap pre-filter only).
    expect(metas[0].tieStart).toBe(true);
    expect(metas[0].tieStop).toBe(false);
  });

  it('rests have no key ties', () => {
    const events: RestEvent[] = [
      rest({ id: 'r1', startTick: 0, durationTicks: ticksFor('quarter', PPQ) }),
    ];
    const { metas } = buildVoiceContent(recorded(events), PPQ);
    expect(metas[0].keyTies).toEqual([]);
  });
});

describe('fermatas', () => {
  /** The glyph codes on a note's Articulation modifiers. */
  function articulationCodes(staveNote: {
    getModifiers: () => { getCategory: () => string }[];
  }): string[] {
    return staveNote
      .getModifiers()
      .filter(m => m.getCategory() === 'Articulation')
      .map(m => (m as unknown as { type: string }).type);
  }

  it('attaches a fermata glyph to a note that carries one', () => {
    const events: NoteEvent[] = [
      note({
        id: 'held',
        startTick: 0,
        durationTicks: ticksFor('quarter', PPQ),
        pitch: pitch('C', 0, 4),
        fermata: true,
      }),
    ];
    const { notes } = buildVoiceContent(recorded(events), PPQ);
    expect(articulationCodes(notes[0]).some(c => c.startsWith('a@'))).toBe(
      true
    );
  });

  it('attaches nothing to a note without one', () => {
    const events: NoteEvent[] = [
      note({
        id: 'plain',
        startTick: 0,
        durationTicks: ticksFor('quarter', PPQ),
        pitch: pitch('C', 0, 4),
      }),
    ];
    const { notes } = buildVoiceContent(recorded(events), PPQ);
    expect(articulationCodes(notes[0])).toHaveLength(0);
  });

  it('draws it above the stave whatever the pitch', () => {
    // Standard engraving for single-voice music: the fermata sits above the
    // stave, and the inverted glyph belongs to a lower voice rather than to a
    // stem-down note. Pinned across the range because the tempting
    // alternative — choosing from `getStemDirection()` — reports Stem.UP for
    // every pitch at this point and would invert the whole score.
    for (const p of [pitch('C', 0, 4), pitch('A', 0, 5), pitch('G', 0, 3)]) {
      const built = buildVoiceContent(
        recorded([
          note({
            id: `n-${p.step}${p.octave}`,
            startTick: 0,
            durationTicks: ticksFor('quarter', PPQ),
            pitch: p,
            fermata: true,
          }),
        ]),
        PPQ
      ).notes[0];
      expect(articulationCodes(built)).toContain('a@a');
    }
  });

  it('coexists with an articulation on the same note', () => {
    const events: NoteEvent[] = [
      note({
        id: 'both',
        startTick: 0,
        durationTicks: ticksFor('quarter', PPQ),
        pitch: pitch('C', 0, 4),
        articulation: 'accent',
        fermata: true,
      }),
    ];
    const { notes } = buildVoiceContent(recorded(events), PPQ);
    const codes = articulationCodes(notes[0]);
    expect(codes).toContain('a>');
    expect(codes.some(c => c.startsWith('a@'))).toBe(true);
  });
});

describe('ornaments', () => {
  /** The SMuFL glyph codes on a note's Ornament modifiers. */
  function ornamentGlyphs(staveNote: {
    getModifiers: () => { getCategory: () => string }[];
  }): string[] {
    return staveNote
      .getModifiers()
      .filter(m => m.getCategory() === 'Ornament')
      .map(
        m =>
          (m as unknown as { ornament?: { code?: string } }).ornament?.code ??
          ''
      );
  }

  function built(ornament: NoteEvent['ornament']) {
    return buildVoiceContent(
      recorded([
        note({
          id: 'orn',
          startTick: 0,
          durationTicks: ticksFor('quarter', PPQ),
          pitch: pitch('C', 0, 4),
          ornament,
        }),
      ]),
      PPQ
    ).notes[0];
  }

  it('draws a trill', () => {
    expect(ornamentGlyphs(built('trill'))).toEqual(['ornamentTrill']);
  });

  it('draws a turn', () => {
    expect(ornamentGlyphs(built('turn'))).toEqual(['ornamentTurn']);
  });

  it('draws the stroked glyph for a mordent and the plain one for an inverted mordent', () => {
    // The trap this pins: VexFlow's 'mordent' code draws ornamentShortTrill —
    // the *unstroked* upper mordent — and its 'mordent_inverted' draws the
    // stroked ornamentMordent. Mapping the two by name gets them backwards,
    // which looks plausible on screen and is wrong in every edition.
    expect(ornamentGlyphs(built('mordent'))).toEqual(['ornamentMordent']);
    expect(ornamentGlyphs(built('inverted-mordent'))).toEqual([
      'ornamentShortTrill',
    ]);
  });

  it('attaches nothing to a note without one', () => {
    expect(ornamentGlyphs(built(undefined))).toHaveLength(0);
  });
});

describe('hairpin metadata and arpeggios', () => {
  it('carries the hairpin direction on the opening note', () => {
    // The renderer needs the direction, not just "a hairpin starts here" —
    // it decides which way the wedge opens.
    const { metas } = buildVoiceContent(
      recorded([
        note({
          id: 'open',
          startTick: 0,
          durationTicks: ticksFor('quarter', PPQ),
          pitch: pitch('C', 0, 4),
          hairpinStart: 'diminuendo',
        }),
        note({
          id: 'close',
          startTick: ticksFor('quarter', PPQ),
          durationTicks: ticksFor('quarter', PPQ),
          pitch: pitch('E', 0, 4),
          hairpinStop: true,
        }),
      ]),
      PPQ
    );

    expect(metas[0].hairpinStart).toBe('diminuendo');
    expect(metas[0].hairpinStop).toBe(false);
    expect(metas[1].hairpinStart).toBeNull();
    expect(metas[1].hairpinStop).toBe(true);
  });

  it('leaves an unmarked note with no hairpin metadata', () => {
    const { metas } = buildVoiceContent(
      recorded([
        note({
          id: 'p',
          startTick: 0,
          durationTicks: ticksFor('quarter', PPQ),
          pitch: pitch('C', 0, 4),
        }),
      ]),
      PPQ
    );
    expect(metas[0].hairpinStart).toBeNull();
    expect(metas[0].hairpinStop).toBe(false);
  });

  it('strokes a rolled chord once, not once per notehead', () => {
    const half = ticksFor('half', PPQ);
    const chord = ['C', 'E', 'G'].map((step, i) =>
      note({
        id: `c${i}`,
        startTick: 0,
        durationTicks: half,
        pitch: pitch(step as 'C', 0, 4),
        arpeggiate: true,
      })
    );
    const { notes } = buildVoiceContent(recorded(chord), PPQ);
    const strokes = notes[0]
      .getModifiers()
      .filter(m => m.getCategory() === 'Stroke');
    expect(strokes).toHaveLength(1);
  });

  it('draws no stroke on a single note', () => {
    // There is only one notehead to roll through.
    const { notes } = buildVoiceContent(
      recorded([
        note({
          id: 'solo',
          startTick: 0,
          durationTicks: ticksFor('quarter', PPQ),
          pitch: pitch('C', 0, 4),
          arpeggiate: true,
        }),
      ]),
      PPQ
    );
    expect(
      notes[0].getModifiers().filter(m => m.getCategory() === 'Stroke')
    ).toHaveLength(0);
  });
});
