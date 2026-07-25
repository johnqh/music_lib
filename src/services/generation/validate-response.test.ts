import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../../domain/score/factory';
import { validateScore } from '../../domain/validation/validator';
import { GenerationValidationError, sanitizeGeneratedScore } from './validate-response';

/** Round-trips through JSON to simulate an untrusted network response (strips `undefined`, deep-clones). */
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function baseRawScore() {
  const score = createEmptyScore({ title: 'Generated', measures: 2, tracks: [{ name: 'Piano' }] });
  return asJson(score) as ReturnType<typeof createEmptyScore>;
}

describe('sanitizeGeneratedScore — repairs', () => {
  it('regenerates every id and re-links trackId/voiceId references', () => {
    const raw = baseRawScore();
    const originalScoreId = raw.id;
    const originalTrackId = raw.tracks[0].id;
    const originalMeasureId = raw.tracks[0].measures[0].id;
    const originalVoiceId = raw.tracks[0].measures[0].voices[0].id;
    const originalEventId = raw.tracks[0].measures[0].voices[0].events[0].id;

    const { score, warnings } = sanitizeGeneratedScore(raw);

    expect(score.id).not.toBe(originalScoreId);
    expect(score.tracks[0].id).not.toBe(originalTrackId);
    expect(score.tracks[0].measures[0].id).not.toBe(originalMeasureId);
    expect(score.tracks[0].measures[0].voices[0].id).not.toBe(originalVoiceId);
    expect(score.tracks[0].measures[0].voices[0].events[0].id).not.toBe(originalEventId);

    // Referential consistency preserved after the id swap.
    const event = score.tracks[0].measures[0].voices[0].events[0];
    expect(event.trackId).toBe(score.tracks[0].id);
    expect(event.voiceId).toBe(score.tracks[0].measures[0].voices[0].id);

    // Every id in the whole score is unique post-sanitize.
    expect(validateScore(score).filter((i) => i.severity === 'error')).toEqual([]);
    expect(warnings.some((w) => w.toLowerCase().includes('id'))).toBe(true);
  });

  it('pads an underfull voice with rests so it exactly fills the measure', () => {
    const raw = baseRawScore();
    // Shrink the first (only) event's duration, leaving a gap.
    const event = raw.tracks[0].measures[0].voices[0].events[0];
    const originalDuration = event.durationTicks;
    event.durationTicks = Math.floor(originalDuration / 2);

    const { score, warnings } = sanitizeGeneratedScore(raw);
    const measure = score.tracks[0].measures[0];
    const covered = measure.voices[0].events.reduce((sum, e) => sum + e.durationTicks, 0);

    expect(covered).toBe(measure.durationTicks);
    expect(measure.voices[0].events.length).toBeGreaterThan(1); // original (shrunk) note + at least one padding rest
    expect(warnings.some((w) => w.toLowerCase().includes('padded'))).toBe(true);
    expect(validateScore(score).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('normalizes measure index/startTick and shifts events consistently (measure grid normalization)', () => {
    const raw = baseRawScore();
    const measureTicks = raw.tracks[0].measures[0].durationTicks;

    // Corrupt the second measure's bookkeeping (wrong index/startTick), while keeping
    // its own event ticks self-consistent (relative to its own claimed startTick).
    const secondMeasure = raw.tracks[0].measures[1];
    const wrongStart = 999999;
    const delta = wrongStart - secondMeasure.startTick;
    secondMeasure.startTick = wrongStart;
    secondMeasure.index = 5;
    for (const voice of secondMeasure.voices) {
      for (const event of voice.events) {
        event.startTick += delta;
      }
    }

    const { score } = sanitizeGeneratedScore(raw);
    const fixed = score.tracks[0].measures[1];

    expect(fixed.index).toBe(1);
    expect(fixed.startTick).toBe(measureTicks);
    expect(fixed.voices[0].events[0].startTick).toBe(measureTicks);
    expect(validateScore(score).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('sanitizeGeneratedScore — rejects', () => {
  it('rejects malformed JSON that does not match the Score schema', () => {
    expect(() => sanitizeGeneratedScore({ not: 'a score' })).toThrow(GenerationValidationError);
  });

  it('rejects a negative/zero duration event', () => {
    const raw = baseRawScore();
    raw.tracks[0].measures[0].voices[0].events[0].durationTicks = 0;
    expect(() => sanitizeGeneratedScore(raw)).toThrow(GenerationValidationError);
  });

  it('rejects an overfull measure (covered ticks exceed measure duration)', () => {
    const raw = baseRawScore();
    const voice = raw.tracks[0].measures[0].voices[0];
    const event = voice.events[0];
    // Add a second, overlapping note so the voice covers more than the measure.
    voice.events.push({
      ...event,
      id: 'extra-note',
      pitch: { step: 'D', accidental: 0, octave: 5 },
      startTick: event.startTick,
      durationTicks: raw.tracks[0].measures[0].durationTicks * 2,
      velocity: 90,
    });
    expect(() => sanitizeGeneratedScore(raw)).toThrow(GenerationValidationError);
  });

  it('rejects a note outside the allowed pitch range when a range is given via context', () => {
    const raw = baseRawScore();
    // The default track has a rest covering the whole measure; replace it with an out-of-range note.
    raw.tracks[0].measures[0].voices[0].events[0] = {
      id: 'high-note',
      pitch: { step: 'C', accidental: 0, octave: 8 }, // midi 108
      startTick: 0,
      durationTicks: raw.tracks[0].measures[0].durationTicks,
      velocity: 90,
      voiceId: raw.tracks[0].measures[0].voices[0].id,
      trackId: raw.tracks[0].id,
    };

    expect(() =>
      sanitizeGeneratedScore(raw, { tracks: [{ range: { lowestMidi: 40, highestMidi: 80 } }] }),
    ).toThrow(GenerationValidationError);

    // Without the context constraint, the same score is not rejected on range grounds.
    expect(() => sanitizeGeneratedScore(raw)).not.toThrow();
  });

  it('rejects overlapping notes in a voice whose track has maximumPolyphony 1', () => {
    const raw = baseRawScore();
    const voice = raw.tracks[0].measures[0].voices[0];
    const event = voice.events[0];
    voice.events[0] = {
      ...event,
      id: 'note-a',
      pitch: { step: 'C', accidental: 0, octave: 4 },
      startTick: 0,
      durationTicks: raw.tracks[0].measures[0].durationTicks,
      velocity: 90,
    };
    voice.events.push({
      ...event,
      id: 'note-b',
      pitch: { step: 'E', accidental: 0, octave: 4 },
      startTick: 0,
      durationTicks: raw.tracks[0].measures[0].durationTicks,
      velocity: 90,
    });

    expect(() => sanitizeGeneratedScore(raw, { tracks: [{ maximumPolyphony: 1 }] })).toThrow(
      GenerationValidationError,
    );

    // Without maximumPolyphony: 1 in context, the same overlap is not rejected on polyphony grounds
    // (block chords are a normal, valid construct otherwise).
    expect(() => sanitizeGeneratedScore(raw)).not.toThrow();
  });

  it('GenerationValidationError.issues lists every unrepairable problem found, not just the first', () => {
    const raw = baseRawScore();
    raw.tracks[0].measures[0].voices[0].events[0].durationTicks = -10;
    try {
      sanitizeGeneratedScore(raw);
      expect.fail('expected sanitizeGeneratedScore to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationValidationError);
      expect((error as GenerationValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});
