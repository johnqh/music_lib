import { describe, expect, it } from 'vitest';
import {
  STEM_ORDER,
  drumHitsToNotes,
  scoreStems,
  stemInstrument,
  stemsEndTick,
  type TranscribedStem,
} from './stems.js';
import { DRUM_KICK, DRUM_SNARE } from './drums.js';
import { isPercussionTrack } from '../instruments/track-instrument.js';
import { gmKitAt } from '../instruments/gm-kit.js';

describe('stemInstrument', () => {
  it('puts the drum stem on a percussion clef, which is what makes it a kit', () => {
    // `midiProgram` names an instrument on a pitched track and a kit on a
    // percussion one, and only the clef says which — so a drum stem that
    // forgot the clef would come out as an Acoustic Grand Piano.
    const drums = stemInstrument('drums');
    expect(drums.clef).toBe('percussion');
    expect(isPercussionTrack({ clef: drums.clef })).toBe(true);
    // And the program it carries has to be a real kit address.
    expect(gmKitAt(drums.midiProgram)).toBeTruthy();
  });

  it('gives the bass a bass clef, so its notes are readable where they land', () => {
    expect(stemInstrument('bass').clef).toBe('bass');
  });

  it('gives every stem a General MIDI program in range', () => {
    for (const kind of STEM_ORDER) {
      const instrument = stemInstrument(kind);
      expect(instrument.midiProgram).toBeGreaterThanOrEqual(0);
      expect(instrument.midiProgram).toBeLessThanOrEqual(127);
      expect(instrument.name.length).toBeGreaterThan(0);
    }
  });

  it('covers every stem kind, so none can fall through to a default', () => {
    expect(new Set(STEM_ORDER)).toEqual(
      new Set(['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']),
    );
  });
});

describe('drumHitsToNotes', () => {
  it('converts seconds to ticks against the tempo the other stems used', () => {
    // At 120bpm a beat is 0.5s, so a hit at 1.0s is two beats in.
    const notes = drumHitsToNotes(
      [{ midi: DRUM_KICK, startSec: 1, velocity: 1 }],
      120,
      480,
    );
    expect(notes[0].startTick).toBe(960);
    expect(notes[0].midi).toBe(DRUM_KICK);
  });

  it('scales with the tempo rather than ignoring it', () => {
    // The same hit at half the tempo is half as many ticks in — getting this
    // backwards would let the drums drift against the parts they came with.
    const hit = [{ midi: DRUM_SNARE, startSec: 1, velocity: 1 }];
    expect(drumHitsToNotes(hit, 60, 480)[0].startTick).toBe(480);
    expect(drumHitsToNotes(hit, 120, 480)[0].startTick).toBe(960);
  });

  it('writes strokes short, and never zero-length', () => {
    const notes = drumHitsToNotes([{ midi: DRUM_KICK, startSec: 0, velocity: 1 }], 120, 480);
    expect(notes[0].durationTicks).toBe(120);
    expect(drumHitsToNotes([{ midi: DRUM_KICK, startSec: 0, velocity: 1 }], 120, 1)[0].durationTicks)
      .toBeGreaterThanOrEqual(1);
  });

  it('never places a stroke before the start of the score', () => {
    const notes = drumHitsToNotes([{ midi: DRUM_KICK, startSec: -0.5, velocity: 1 }], 120, 480);
    expect(notes[0].startTick).toBe(0);
  });
});

describe('scoreStems', () => {
  const stem = (kind: TranscribedStem['kind'], count: number): TranscribedStem => ({
    kind,
    notes: Array.from({ length: count }, (_, i) => ({
      midi: 60,
      startTick: i * 480,
      durationTicks: 240,
    })),
  });

  it('drops stems that came back empty', () => {
    // Separation returns every stem it knows, silence included: a song with no
    // guitar still yields a guitar stem, and an empty track for it is a part
    // nobody played.
    const kinds = scoreStems([stem('vocals', 3), stem('guitar', 0), stem('bass', 2)]).map(
      (s) => s.kind,
    );
    expect(kinds).toEqual(['vocals', 'bass']);
  });

  it('orders stems the same way regardless of what order they arrived in', () => {
    const kinds = scoreStems([stem('drums', 1), stem('vocals', 1), stem('bass', 1)]).map(
      (s) => s.kind,
    );
    expect(kinds).toEqual(['vocals', 'bass', 'drums']);
  });

  it('returns nothing when every stem was silent', () => {
    expect(scoreStems([stem('vocals', 0), stem('drums', 0)])).toEqual([]);
  });
});

describe('stemsEndTick', () => {
  it('reaches the end of the longest note, not the last onset', () => {
    // The score has to be long enough to hold a note, not just to start it —
    // `addTranscribedTrackCommand` drops anything past the final barline.
    const stems: TranscribedStem[] = [
      { kind: 'vocals', notes: [{ midi: 60, startTick: 0, durationTicks: 1920 }] },
      { kind: 'bass', notes: [{ midi: 40, startTick: 960, durationTicks: 480 }] },
    ];
    expect(stemsEndTick(stems)).toBe(1920);
  });

  it('is zero for nothing at all', () => {
    expect(stemsEndTick([])).toBe(0);
  });
});
