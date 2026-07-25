import { describe, expect, it } from 'vitest';
import { quantizeEvents } from './quantize.js';
import type { QuantizeOptions } from './options.js';
import { isNoteEvent, isRestEvent } from '@sudobility/music_types';
import type { MusicalEvent, NoteEvent, RestEvent } from '@sudobility/music_types';

const TRACK = 't1';
const VOICE = 'v1';

function note(
  startTick: number,
  durationTicks: number,
  overrides: Partial<NoteEvent> = {},
): NoteEvent {
  return {
    id: overrides.id ?? `n-${startTick}-${durationTicks}-${Math.random()}`,
    pitch: overrides.pitch ?? { step: 'C', accidental: 0, octave: 4 },
    startTick,
    durationTicks,
    velocity: overrides.velocity ?? 80,
    voiceId: overrides.voiceId ?? VOICE,
    trackId: overrides.trackId ?? TRACK,
    ...overrides,
  };
}

function rest(
  startTick: number,
  durationTicks: number,
  overrides: Partial<RestEvent> = {},
): RestEvent {
  return {
    id: overrides.id ?? `r-${startTick}-${durationTicks}-${Math.random()}`,
    startTick,
    durationTicks,
    voiceId: overrides.voiceId ?? VOICE,
    trackId: overrides.trackId ?? TRACK,
    ...overrides,
  };
}

const baseOpts: QuantizeOptions = { grid: 480, quantizeStarts: true, quantizeDurations: false };

describe('quantizeEvents', () => {
  it('is a pure function: never mutates the input array or its events', () => {
    const input = [note(10, 480, { id: 'a' })];
    const snapshot = JSON.parse(JSON.stringify(input));

    quantizeEvents(input, baseOpts);

    expect(input).toEqual(snapshot);
  });

  it('returns an empty array for empty input', () => {
    expect(quantizeEvents([], baseOpts)).toEqual([]);
  });

  describe('start quantization', () => {
    it('snaps a start slightly after a grid line down to that grid line', () => {
      const [result] = quantizeEvents([note(10, 240, { id: 'a' })], baseOpts);
      expect(result.startTick).toBe(0);
    });

    it('snaps a start slightly before the next grid line up to it', () => {
      const [result] = quantizeEvents([note(470, 240, { id: 'a' })], baseOpts);
      expect(result.startTick).toBe(480);
    });

    it('snaps a start exactly at the grid midpoint up (round-half-up convention)', () => {
      // grid=480, midpoint between 0 and 480 is 240.
      const [result] = quantizeEvents([note(240, 240, { id: 'a' })], baseOpts);
      expect(result.startTick).toBe(480);
    });

    it('leaves a start untouched when quantizeStarts is false', () => {
      const [result] = quantizeEvents([note(17, 240, { id: 'a' })], {
        ...baseOpts,
        quantizeStarts: false,
      });
      expect(result.startTick).toBe(17);
    });

    it('quantizes rests as well as notes', () => {
      const [result] = quantizeEvents([rest(10, 240, { id: 'a' })], baseOpts);
      expect(result.startTick).toBe(0);
    });

    it('snaps to a triplet subdivision of the grid when tripletGrid is set', () => {
      // grid=480 (quarter), triplet subdivision = 320 ticks (triplet-quarter).
      const [result] = quantizeEvents([note(300, 100, { id: 'a' })], {
        ...baseOpts,
        tripletGrid: true,
      });
      expect(result.startTick).toBe(320);
    });
  });

  describe('humanizeToleranceTicks', () => {
    it('keeps the original start when already within tolerance of the snap target', () => {
      const opts: QuantizeOptions = { ...baseOpts, humanizeToleranceTicks: 15 };
      const [result] = quantizeEvents([note(10, 240, { id: 'a' })], opts); // 10 ticks from grid line 0
      expect(result.startTick).toBe(10);
    });

    it('still snaps when outside tolerance', () => {
      const opts: QuantizeOptions = { ...baseOpts, humanizeToleranceTicks: 5 };
      const [result] = quantizeEvents([note(10, 240, { id: 'a' })], opts); // 10 ticks from grid line 0, tolerance 5
      expect(result.startTick).toBe(0);
    });
  });

  describe('swing', () => {
    it('swing 0 leaves odd grid slots unshifted (straight)', () => {
      // grid=480; note near slot 1 (480) should land exactly on 480.
      const opts: QuantizeOptions = { ...baseOpts, swing: 0 };
      const [result] = quantizeEvents([note(480, 240, { id: 'a' })], opts);
      expect(result.startTick).toBe(480);
    });

    it('swing 0.5 delays odd grid slots by half a grid unit', () => {
      const opts: QuantizeOptions = { ...baseOpts, swing: 0.5 };
      const [result] = quantizeEvents([note(480, 240, { id: 'a' })], opts); // slot 1 (odd)
      expect(result.startTick).toBe(480 + 240);
    });

    it('swing does not affect even grid slots', () => {
      const opts: QuantizeOptions = { ...baseOpts, swing: 0.5 };
      const [result] = quantizeEvents([note(0, 240, { id: 'a' })], opts); // slot 0 (even)
      expect(result.startTick).toBe(0);
    });
  });

  describe('duration quantization', () => {
    it('snaps a duration to the nearest grid multiple', () => {
      const [result] = quantizeEvents([note(0, 500, { id: 'a' })], {
        ...baseOpts,
        quantizeDurations: true,
      });
      expect(result.durationTicks).toBe(480);
    });

    it('leaves durationTicks untouched when quantizeDurations is false', () => {
      const [result] = quantizeEvents([note(0, 500, { id: 'a' })], {
        ...baseOpts,
        quantizeDurations: false,
      });
      expect(result.durationTicks).toBe(500);
    });

    it('clamps a duration that quantizes to zero up to minDurationTicks', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeDurations: true, minDurationTicks: 60 };
      // grid=480; a 100-tick note rounds down to 0 grid units.
      const [result] = quantizeEvents([note(0, 100, { id: 'a' })], opts);
      expect(result.durationTicks).toBe(60);
    });

    it('never emits a zero/negative duration even without minDurationTicks configured', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeDurations: true };
      const [result] = quantizeEvents([note(0, 100, { id: 'a' })], opts);
      expect(result.durationTicks).toBeGreaterThan(0);
    });
  });

  describe('dropping short notes', () => {
    it('drops a note whose original duration is shorter than minDurationTicks', () => {
      const opts: QuantizeOptions = { ...baseOpts, minDurationTicks: 100 };
      const result = quantizeEvents(
        [note(0, 50, { id: 'short' }), note(500, 480, { id: 'long' })],
        opts,
      );
      expect(result.some((e) => e.id === 'short')).toBe(false);
      expect(result.some((e) => e.id === 'long')).toBe(true);
    });

    it('never drops rests, even shorter than minDurationTicks', () => {
      const opts: QuantizeOptions = { ...baseOpts, minDurationTicks: 100 };
      const result = quantizeEvents([rest(0, 50, { id: 'short-rest' })], opts);
      expect(result.some((e) => e.id === 'short-rest')).toBe(true);
    });

    it('does not drop anything when minDurationTicks is not configured', () => {
      const result = quantizeEvents([note(0, 1, { id: 'tiny' })], baseOpts);
      expect(result.some((e) => e.id === 'tiny')).toBe(true);
    });
  });

  describe('chord onset grouping (chordToleranceTicks)', () => {
    it('groups near-simultaneous onsets in the same track+voice onto a shared start tick', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, chordToleranceTicks: 10 };
      const events = [note(0, 480, { id: 'a' }), note(8, 480, { id: 'b' })];
      const result = quantizeEvents(events, opts);
      const a = result.find((e) => e.id === 'a')!;
      const b = result.find((e) => e.id === 'b')!;
      expect(a.startTick).toBe(b.startTick);
    });

    it('leaves onsets further apart than the tolerance ungrouped', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, chordToleranceTicks: 10 };
      const events = [note(0, 480, { id: 'a' }), note(50, 480, { id: 'b' })];
      const result = quantizeEvents(events, opts);
      const a = result.find((e) => e.id === 'a')!;
      const b = result.find((e) => e.id === 'b')!;
      expect(a.startTick).not.toBe(b.startTick);
    });

    it('does not group onsets from different voices', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, chordToleranceTicks: 10 };
      const events = [
        note(0, 480, { id: 'a', voiceId: 'v1' }),
        note(8, 480, { id: 'b', voiceId: 'v2' }),
      ];
      const result = quantizeEvents(events, opts);
      const a = result.find((e) => e.id === 'a')!;
      const b = result.find((e) => e.id === 'b')!;
      expect(a.startTick).toBe(0);
      expect(b.startTick).toBe(8);
    });
  });

  describe('resolveOverlaps', () => {
    it('trims a note that overlaps the next note in the same track+voice', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, resolveOverlaps: true };
      const events = [note(0, 500, { id: 'a' }), note(480, 480, { id: 'b' })];
      const result = quantizeEvents(events, opts);
      const a = result.find((e) => e.id === 'a')!;
      expect(a.startTick + a.durationTicks).toBe(480);
    });

    it('does not trim notes that share the same start tick (a chord, not an overlap)', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, resolveOverlaps: true };
      const events = [note(0, 480, { id: 'a' }), note(0, 240, { id: 'b' })];
      const result = quantizeEvents(events, opts);
      const a = result.find((e) => e.id === 'a')!;
      expect(a.durationTicks).toBe(480);
    });

    it('does not trim notes in different tracks even if their ticks overlap', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, resolveOverlaps: true };
      const events = [
        note(0, 500, { id: 'a', trackId: 't1' }),
        note(480, 480, { id: 'b', trackId: 't2' }),
      ];
      const result = quantizeEvents(events, opts);
      const a = result.find((e) => e.id === 'a')!;
      expect(a.durationTicks).toBe(500);
    });
  });

  describe('legatoCleanup', () => {
    it('extends a note to reach the next note start in the same track+voice', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, legatoCleanup: true };
      const events = [note(0, 200, { id: 'a' }), note(480, 240, { id: 'b' })];
      const result = quantizeEvents(events, opts);
      const a = result.find((e) => e.id === 'a')!;
      expect(a.startTick + a.durationTicks).toBe(480);
    });

    it('does not shrink a note that already reaches (or overlaps) the next note', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, legatoCleanup: true };
      const events = [note(0, 500, { id: 'a' }), note(480, 240, { id: 'b' })];
      const result = quantizeEvents(events, opts);
      const a = result.find((e) => e.id === 'a')!;
      expect(a.durationTicks).toBe(500);
    });
  });

  describe('fillGaps', () => {
    it('inserts a rest to fill a silent gap within a track+voice', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, fillGaps: true };
      const events = [note(0, 240, { id: 'a' }), note(480, 240, { id: 'b' })];
      const result = quantizeEvents(events, opts);
      const gapFiller = result.find((e) => isRestEvent(e) && e.startTick === 240);
      expect(gapFiller).toBeDefined();
      expect(gapFiller?.durationTicks).toBe(240);
    });

    it('does not insert a rest when there is no gap', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, fillGaps: true };
      const events = [note(0, 480, { id: 'a' }), note(480, 240, { id: 'b' })];
      const result = quantizeEvents(events, opts);
      expect(result).toHaveLength(2);
    });

    it('does not insert gap-filling rests when fillGaps is false', () => {
      const opts: QuantizeOptions = { ...baseOpts, quantizeStarts: false, fillGaps: false };
      const events = [note(0, 240, { id: 'a' }), note(480, 240, { id: 'b' })];
      const result = quantizeEvents(events, opts);
      expect(result).toHaveLength(2);
    });
  });

  describe('pipeline composition', () => {
    it('applies drop, start/duration quantization, and gap filling together in a sensible order', () => {
      const opts: QuantizeOptions = {
        grid: 480,
        quantizeStarts: true,
        quantizeDurations: true,
        minDurationTicks: 60,
        fillGaps: true,
      };
      const events: MusicalEvent[] = [
        note(10, 20, { id: 'noise' }), // below minDurationTicks -> dropped
        note(470, 500, { id: 'a' }), // snaps to start 480, duration 480
        note(1400, 240, { id: 'b' }), // snaps to start 1440, leaving a gap
      ];
      const result = quantizeEvents(events, opts);

      expect(result.some((e) => e.id === 'noise')).toBe(false);
      const a = result.find((e) => e.id === 'a')!;
      const b = result.find((e) => e.id === 'b')!;
      expect(a.startTick).toBe(480);
      expect(a.durationTicks).toBe(480);
      expect(b.startTick).toBe(1440);
      expect(isNoteEvent(a) && isNoteEvent(b)).toBe(true);
      // a gap-filling rest should cover [960, 1440).
      const gapFiller = result.find((e) => isRestEvent(e) && e.startTick === 960);
      expect(gapFiller?.durationTicks).toBe(480);
    });
  });
});
