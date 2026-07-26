import { describe, expect, it } from 'vitest';
import { Accidental, Voice } from 'vexflow';
import type { StaveNote } from 'vexflow';
import { buildTies } from './measure-content.js';
import type { Channel } from './measure-content.js';
import { buildVoiceContent, keySignatureToVexSpec } from './convert.js';
import type { NoteMeta } from './convert.js';
import type { KeySignature, NoteEvent, Pitch } from '@sudobility/music_types';
import { ticksFor } from '../../domain/time/ticks.js';

function pitch(step: Pitch['step'], accidental: Pitch['accidental'], octave: number): Pitch {
  return { step, accidental, octave };
}

/** A single-note (non-chord) channel entry, built the same way buildMeasureContent does. */
function channelEntryFor(events: NoteEvent[]): { note: StaveNote; meta: NoteMeta } {
  const { notes, metas } = buildVoiceContent(events, 480);
  return { note: notes[0], meta: metas[0] };
}

describe('buildTies (finding 1: pitch-matched chord ties, not array adjacency)', () => {
  it('ties only the one chord member that actually ties forward, on the correct key indices', () => {
    const quarter = ticksFor('quarter', 480);
    // Measure 1 chord: C4 (ties forward), E4 (does not), G4 (does not).
    const chordA = channelEntryFor([
      { id: 'a-c', pitch: pitch('C', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't', tieStart: true },
      { id: 'a-e', pitch: pitch('E', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
      { id: 'a-g', pitch: pitch('G', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ]);
    // Measure 2 chord: C4 (receives the tie), F4, A4 — different pitches
    // than measure 1's E4/G4, and NOT flagged tieStop, so array-index
    // matching (old behavior) would have wrongly tied E4->F4 and G4->A4
    // too, on top of getting C4 right only by coincidence of index 0.
    const chordB = channelEntryFor([
      { id: 'b-c', pitch: pitch('C', 0, 4), startTick: quarter, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't', tieStop: true },
      { id: 'b-f', pitch: pitch('F', 0, 4), startTick: quarter, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
      { id: 'b-a', pitch: pitch('A', 0, 4), startTick: quarter, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
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
      { id: 'a', pitch: pitch('C', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't', tieStart: true },
    ]);
    // tieStop is set, but the pitch is different (D4 vs C4) — e.g. corrupt
    // data, or two coincidentally-adjacent unrelated notes; must not tie.
    const b = channelEntryFor([
      { id: 'b', pitch: pitch('D', 0, 4), startTick: quarter, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't', tieStop: true },
    ]);
    const ties = buildTies([a, b]);
    expect(ties).toHaveLength(0);
  });

  it('ties every matching member of an all-tied chord (all pitches identical)', () => {
    const half = ticksFor('half', 480);
    const a = channelEntryFor([
      { id: 'a-c', pitch: pitch('C', 0, 4), startTick: 0, durationTicks: half, velocity: 80, voiceId: 'v', trackId: 't', tieStart: true },
      { id: 'a-e', pitch: pitch('E', 0, 4), startTick: 0, durationTicks: half, velocity: 80, voiceId: 'v', trackId: 't', tieStart: true },
    ]);
    const b = channelEntryFor([
      { id: 'b-c', pitch: pitch('C', 0, 4), startTick: half, durationTicks: half, velocity: 80, voiceId: 'v', trackId: 't', tieStop: true },
      { id: 'b-e', pitch: pitch('E', 0, 4), startTick: half, durationTicks: half, velocity: 80, voiceId: 'v', trackId: 't', tieStop: true },
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
  function accidentalCategoriesFor(events: NoteEvent[], keySignature: KeySignature): string[][] {
    const { notes } = buildVoiceContent(events, 480);
    const voice = new Voice({ num_beats: 4, beat_value: 4 }).setMode(Voice.Mode.SOFT);
    voice.addTickables(notes);
    Accidental.applyAccidentals([voice], keySignatureToVexSpec(keySignature));
    return notes.map((n) => n.getModifiers().filter((m) => m.getCategory() === 'Accidental').map(() => 'Accidental'));
  }

  const quarter = ticksFor('quarter', 480);
  const gMajor: KeySignature = { fifths: 1, mode: 'major' };
  const cMajor: KeySignature = { fifths: 0, mode: 'major' };

  it('draws no accidental for an F# in G major (implied by the key signature)', () => {
    const events: NoteEvent[] = [
      { id: 'n', pitch: pitch('F', 1, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ];
    const [categories] = accidentalCategoriesFor(events, gMajor);
    expect(categories).toEqual([]);
  });

  it('draws a natural sign for an F-natural in G major (contradicts the key signature)', () => {
    const events: NoteEvent[] = [
      { id: 'n', pitch: pitch('F', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ];
    const [categories] = accidentalCategoriesFor(events, gMajor);
    expect(categories).toEqual(['Accidental']);
  });

  it('draws an accidental for a chromatic note in C major', () => {
    const events: NoteEvent[] = [
      { id: 'n', pitch: pitch('C', 1, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ];
    const [categories] = accidentalCategoriesFor(events, cMajor);
    expect(categories).toEqual(['Accidental']);
  });

  it('draws no accidental for an in-key natural note in C major', () => {
    const events: NoteEvent[] = [
      { id: 'n', pitch: pitch('D', 0, 4), startTick: 0, durationTicks: quarter, velocity: 80, voiceId: 'v', trackId: 't' },
    ];
    const [categories] = accidentalCategoriesFor(events, cMajor);
    expect(categories).toEqual([]);
  });
});
