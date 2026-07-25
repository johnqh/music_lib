import { describe, expect, it } from 'vitest';
import { validateScore } from './validator.js';
import { ISSUE_CODES } from './issues.js';
import { createEmptyScore } from '../score/factory.js';
import { replaceFragment } from '../score/fragment.js';
import { chordScore, twinkleScore, twoTrackScore } from '../../test/fixtures.js';
import type { Measure, NoteEvent, Score, Track } from '@sudobility/music_types';

describe('validateScore', () => {
  it('reports no issues for a well-formed single-track melody score', () => {
    expect(validateScore(twinkleScore())).toEqual([]);
  });

  it('reports no issues for a well-formed two-track score', () => {
    expect(validateScore(twoTrackScore())).toEqual([]);
  });

  it('reports no issues for a well-formed block-chord score', () => {
    expect(validateScore(chordScore())).toEqual([]);
  });

  describe('unique IDs', () => {
    it('flags a duplicate note id', () => {
      const score = twinkleScore();
      const track = score.tracks[0];
      const firstNoteId = track.measures[0].voices[0].events[0].id;
      const mutated: Score = {
        ...score,
        tracks: [
          {
            ...track,
            measures: [
              {
                ...track.measures[0],
                voices: [
                  {
                    ...track.measures[0].voices[0],
                    events: track.measures[0].voices[0].events.map((e, i) =>
                      i === 1 ? { ...e, id: firstNoteId } : e,
                    ),
                  },
                ],
              },
              ...track.measures.slice(1),
            ],
          },
          ...score.tracks.slice(1),
        ],
      };

      const issues = validateScore(mutated);
      const dup = issues.find((i) => i.code === ISSUE_CODES.DUPLICATE_ID);
      expect(dup).toBeDefined();
      expect(dup?.severity).toBe('error');
      expect(dup?.objectId).toBe(firstNoteId);
    });
  });

  describe('pitch range', () => {
    it('flags a note whose MIDI pitch exceeds 127', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const outOfRange: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 11 }, // midi 144
        startTick: 0,
        durationTicks: measure.durationTicks,
        velocity: 80,
        voiceId: measure.voices[0].id,
        trackId: track.id,
      };
      const mutated = withSingleVoiceEvents(score, [outOfRange]);

      const issues = validateScore(mutated);
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_PITCH_RANGE)).toBe(true);
    });
  });

  describe('durations and ticks', () => {
    it('flags a non-positive duration', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const zeroLength: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: 0,
        velocity: 80,
        voiceId: measure.voices[0].id,
        trackId: track.id,
      };
      const mutated = withSingleVoiceEvents(score, [zeroLength]);

      const issues = validateScore(mutated);
      expect(issues.some((i) => i.code === ISSUE_CODES.NON_POSITIVE_DURATION)).toBe(true);
    });

    it('flags a negative startTick', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const negativeStart: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: -10,
        durationTicks: measure.durationTicks,
        velocity: 80,
        voiceId: measure.voices[0].id,
        trackId: track.id,
      };
      const mutated = withSingleVoiceEvents(score, [negativeStart]);

      const issues = validateScore(mutated);
      expect(issues.some((i) => i.code === ISSUE_CODES.NEGATIVE_TICK)).toBe(true);
    });
  });

  describe('velocity', () => {
    it('flags velocity above 127', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const note: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: measure.durationTicks,
        velocity: 200,
        voiceId: measure.voices[0].id,
        trackId: track.id,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [note]));
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_VELOCITY)).toBe(true);
    });

    it('flags negative velocity', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const note: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: measure.durationTicks,
        velocity: -1,
        voiceId: measure.voices[0].id,
        trackId: track.id,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [note]));
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_VELOCITY)).toBe(true);
    });
  });

  describe('track-level MIDI fields', () => {
    it('flags an out-of-range midiProgram', () => {
      const score = createEmptyScore({ title: 'S', tracks: [{ name: 'P', midiProgram: 128 }] });
      const issues = validateScore(score);
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_MIDI_PROGRAM)).toBe(true);
    });

    it('flags an out-of-range midiChannel', () => {
      const score = createEmptyScore({ title: 'S', tracks: [{ name: 'P', midiChannel: 16 }] });
      const issues = validateScore(score);
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_MIDI_CHANNEL)).toBe(true);
    });
  });

  describe('time signature', () => {
    it('flags numerator 0', () => {
      const score = withTimeSignature(createEmptyScore({ title: 'S' }), {
        numerator: 0,
        denominator: 4,
      });
      const issues = validateScore(score);
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_TIME_SIGNATURE)).toBe(true);
    });

    it('flags a denominator outside {1,2,4,8,16,32}', () => {
      const score = withTimeSignature(createEmptyScore({ title: 'S' }), {
        numerator: 4,
        denominator: 3,
      });
      const issues = validateScore(score);
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_TIME_SIGNATURE)).toBe(true);
    });

    it('accepts every valid denominator', () => {
      for (const denominator of [1, 2, 4, 8, 16, 32]) {
        const score = withTimeSignature(createEmptyScore({ title: 'S' }), {
          numerator: 4,
          denominator,
        });
        const issues = validateScore(score);
        expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_TIME_SIGNATURE)).toBe(false);
      }
    });
  });

  describe('key signature', () => {
    it('flags fifths above 7', () => {
      const score = withKeySignature(createEmptyScore({ title: 'S' }), {
        fifths: 8,
        mode: 'major',
      });
      const issues = validateScore(score);
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_KEY_SIGNATURE)).toBe(true);
    });

    it('flags fifths below -7', () => {
      const score = withKeySignature(createEmptyScore({ title: 'S' }), {
        fifths: -8,
        mode: 'major',
      });
      const issues = validateScore(score);
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_KEY_SIGNATURE)).toBe(true);
    });

    it('accepts the boundary values -7 and 7', () => {
      for (const fifths of [-7, 7]) {
        const score = withKeySignature(createEmptyScore({ title: 'S' }), { fifths, mode: 'major' });
        expect(validateScore(score).some((i) => i.code === ISSUE_CODES.INVALID_KEY_SIGNATURE)).toBe(
          false,
        );
      }
    });
  });

  describe('measure voice content sum', () => {
    it('errors when a voice sums to more than the measure duration (overfull)', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const note: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: measure.durationTicks + 480,
        velocity: 80,
        voiceId: measure.voices[0].id,
        trackId: track.id,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [note], { clampToMeasure: false }));
      const overfull = issues.find((i) => i.code === ISSUE_CODES.MEASURE_OVERFULL);
      expect(overfull).toBeDefined();
      expect(overfull?.severity).toBe('error');
    });

    it('warns when a voice sums to less than the measure duration (underfull)', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const note: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: 240,
        velocity: 80,
        voiceId: measure.voices[0].id,
        trackId: track.id,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [note]));
      const underfull = issues.find((i) => i.code === ISSUE_CODES.MEASURE_UNDERFULL);
      expect(underfull).toBeDefined();
      expect(underfull?.severity).toBe('warning');
    });

    it('reports neither overfull nor underfull when a voice exactly fills the measure', () => {
      const score = createEmptyScore({ title: 'S' });
      const issues = validateScore(score); // default rest-measure already fills exactly
      expect(issues.some((i) => i.code === ISSUE_CODES.MEASURE_OVERFULL)).toBe(false);
      expect(issues.some((i) => i.code === ISSUE_CODES.MEASURE_UNDERFULL)).toBe(false);
    });
  });

  describe('events within their measure', () => {
    it('flags a note that starts before its measure', () => {
      const score = createEmptyScore({ title: 'S', measures: 2 });
      const track = score.tracks[0];
      const secondMeasure = track.measures[1];
      const note: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: secondMeasure.startTick - 10,
        durationTicks: secondMeasure.durationTicks,
        velocity: 80,
        voiceId: secondMeasure.voices[0].id,
        trackId: track.id,
      };
      const measures = track.measures.map((m, i) =>
        i === 1 ? { ...m, voices: [{ ...m.voices[0], events: [note] }] } : m,
      );
      const mutated: Score = { ...score, tracks: [{ ...track, measures }] };

      const issues = validateScore(mutated);
      expect(issues.some((i) => i.code === ISSUE_CODES.EVENT_OUTSIDE_MEASURE)).toBe(true);
    });

    it('flags a note that extends past the end of its measure', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const note: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: measure.durationTicks + 1,
        velocity: 80,
        voiceId: measure.voices[0].id,
        trackId: track.id,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [note], { clampToMeasure: false }));
      expect(issues.some((i) => i.code === ISSUE_CODES.EVENT_OUTSIDE_MEASURE)).toBe(true);
    });
  });

  describe('track/voice references', () => {
    it('flags an event whose trackId does not match its containing track', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const note: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: measure.durationTicks,
        velocity: 80,
        voiceId: measure.voices[0].id,
        trackId: 'wrong-track-id',
      };
      const issues = validateScore(withSingleVoiceEvents(score, [note]));
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_TRACK_REFERENCE)).toBe(true);
    });

    it('flags an event whose voiceId does not match its containing voice', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const note: NoteEvent = {
        id: 'n1',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: measure.durationTicks,
        velocity: 80,
        voiceId: 'wrong-voice-id',
        trackId: track.id,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [note]));
      expect(issues.some((i) => i.code === ISSUE_CODES.INVALID_VOICE_REFERENCE)).toBe(true);
    });
  });

  describe('overlapping same-pitch events', () => {
    it('errors when two same-pitch notes in one voice overlap in time', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const voiceId = measure.voices[0].id;
      const a: NoteEvent = {
        id: 'a',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: 480,
        velocity: 80,
        voiceId,
        trackId: track.id,
      };
      const b: NoteEvent = {
        id: 'b',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 240,
        durationTicks: 480,
        velocity: 80,
        voiceId,
        trackId: track.id,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [a, b], { clampToMeasure: false }));
      expect(issues.some((i) => i.code === ISSUE_CODES.OVERLAPPING_SAME_PITCH)).toBe(true);
    });

    it('does not flag overlapping notes of different pitch (a chord/independent line, not scoped by this rule)', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const voiceId = measure.voices[0].id;
      const a: NoteEvent = {
        id: 'a',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: 480,
        velocity: 80,
        voiceId,
        trackId: track.id,
      };
      const b: NoteEvent = {
        id: 'b',
        pitch: { step: 'E', accidental: 0, octave: 4 },
        startTick: 240,
        durationTicks: 480,
        velocity: 80,
        voiceId,
        trackId: track.id,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [a, b], { clampToMeasure: false }));
      expect(issues.some((i) => i.code === ISSUE_CODES.OVERLAPPING_SAME_PITCH)).toBe(false);
    });

    it('does not flag same-pitch notes that merely share a start tick (a doubled unison, not an overlap)', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const voiceId = measure.voices[0].id;
      const a: NoteEvent = {
        id: 'a',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: 240,
        velocity: 80,
        voiceId,
        trackId: track.id,
      };
      const b: NoteEvent = {
        id: 'b',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 240,
        durationTicks: 240,
        velocity: 80,
        voiceId,
        trackId: track.id,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [a, b]));
      expect(issues.some((i) => i.code === ISSUE_CODES.OVERLAPPING_SAME_PITCH)).toBe(false);
    });
  });

  describe('too many simultaneous notes', () => {
    it('warns when more than the readability threshold sound at once on one track', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const voiceId = measure.voices[0].id;
      const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
      const notes: NoteEvent[] = Array.from({ length: 12 }, (_, i) => ({
        id: `n${i}`,
        pitch: {
          step: steps[i % steps.length],
          accidental: 0,
          octave: 3 + Math.floor(i / steps.length),
        },
        startTick: 0,
        durationTicks: measure.durationTicks,
        velocity: 80,
        voiceId,
        trackId: track.id,
      }));
      const issues = validateScore(withSingleVoiceEvents(score, notes));
      const warning = issues.find((i) => i.code === ISSUE_CODES.TOO_MANY_SIMULTANEOUS_NOTES);
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe('warning');
    });

    it('does not warn for a normal-sized chord', () => {
      expect(
        validateScore(chordScore()).some((i) => i.code === ISSUE_CODES.TOO_MANY_SIMULTANEOUS_NOTES),
      ).toBe(false);
    });
  });

  describe('tempo map', () => {
    it('flags an unsorted tempo map', () => {
      const score = createEmptyScore({ title: 'S', measures: 4 });
      const mutated: Score = {
        ...score,
        tempoMap: [
          { id: 't1', tick: 1920, bpm: 100 },
          { id: 't2', tick: 0, bpm: 120 },
        ],
      };
      const issues = validateScore(mutated);
      expect(issues.some((i) => i.code === ISSUE_CODES.TEMPO_MAP_UNSORTED)).toBe(true);
    });

    it('flags a bpm above 400', () => {
      const score = createEmptyScore({ title: 'S' });
      const mutated: Score = { ...score, tempoMap: [{ id: 't1', tick: 0, bpm: 500 }] };
      expect(validateScore(mutated).some((i) => i.code === ISSUE_CODES.INVALID_TEMPO_BPM)).toBe(
        true,
      );
    });

    it('flags a bpm below 20', () => {
      const score = createEmptyScore({ title: 'S' });
      const mutated: Score = { ...score, tempoMap: [{ id: 't1', tick: 0, bpm: 5 }] };
      expect(validateScore(mutated).some((i) => i.code === ISSUE_CODES.INVALID_TEMPO_BPM)).toBe(
        true,
      );
    });

    it('accepts the boundary bpms 20 and 400', () => {
      for (const bpm of [20, 400]) {
        const score = createEmptyScore({ title: 'S' });
        const mutated: Score = { ...score, tempoMap: [{ id: 't1', tick: 0, bpm }] };
        expect(validateScore(mutated).some((i) => i.code === ISSUE_CODES.INVALID_TEMPO_BPM)).toBe(
          false,
        );
      }
    });
  });

  describe('measure index/startTick ordering', () => {
    it('flags a measure whose startTick does not follow the previous measure', () => {
      const score = createEmptyScore({ title: 'S', measures: 2 });
      const track = score.tracks[0];
      const measures: Measure[] = [track.measures[0], { ...track.measures[1], startTick: 999999 }];
      const mutated: Score = { ...score, tracks: [{ ...track, measures }] };

      const issues = validateScore(mutated);
      expect(issues.some((i) => i.code === ISSUE_CODES.MEASURE_ORDERING)).toBe(true);
    });

    it('flags a measure whose index does not match its position', () => {
      const score = createEmptyScore({ title: 'S', measures: 2 });
      const track = score.tracks[0];
      const measures: Measure[] = [track.measures[0], { ...track.measures[1], index: 5 }];
      const mutated: Score = { ...score, tracks: [{ ...track, measures }] };

      const issues = validateScore(mutated);
      expect(issues.some((i) => i.code === ISSUE_CODES.MEASURE_ORDERING)).toBe(true);
    });
  });

  describe('tie targets', () => {
    it('warns when a tieStart note has no matching tieStop note at the next position with the same pitch', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const voiceId = measure.voices[0].id;
      const a: NoteEvent = {
        id: 'a',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: measure.durationTicks,
        velocity: 80,
        voiceId,
        trackId: track.id,
        tieStart: true,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [a]));
      const warning = issues.find((i) => i.code === ISSUE_CODES.MISSING_TIE_TARGET);
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe('warning');
      expect(warning?.objectId).toBe('a');
    });

    it('warns when a tieStop note has no matching tieStart note ending at its start tick', () => {
      const score = createEmptyScore({ title: 'S' });
      const track = score.tracks[0];
      const measure = track.measures[0];
      const voiceId = measure.voices[0].id;
      const a: NoteEvent = {
        id: 'a',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: 0,
        durationTicks: measure.durationTicks,
        velocity: 80,
        voiceId,
        trackId: track.id,
        tieStop: true,
      };
      const issues = validateScore(withSingleVoiceEvents(score, [a]));
      expect(issues.some((i) => i.code === ISSUE_CODES.MISSING_TIE_TARGET)).toBe(true);
    });

    it('reports no tie-target issue for a correctly tied pair across two measures', () => {
      const score = createEmptyScore({ title: 'S', measures: 2 });
      const track = score.tracks[0];
      const m0 = track.measures[0];
      const m1 = track.measures[1];
      const a: NoteEvent = {
        id: 'a',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: m0.startTick,
        durationTicks: m0.durationTicks,
        velocity: 80,
        voiceId: m0.voices[0].id,
        trackId: track.id,
        tieStart: true,
      };
      const b: NoteEvent = {
        id: 'b',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: m1.startTick,
        durationTicks: m1.durationTicks,
        velocity: 80,
        voiceId: m1.voices[0].id,
        trackId: track.id,
        tieStop: true,
      };
      const measures: Measure[] = [
        { ...m0, voices: [{ ...m0.voices[0], events: [a] }] },
        { ...m1, voices: [{ ...m1.voices[0], events: [b] }] },
      ];
      const mutated: Score = { ...score, tracks: [{ ...track, measures }] };

      const issues = validateScore(mutated);
      expect(issues.some((i) => i.code === ISSUE_CODES.MISSING_TIE_TARGET)).toBe(false);
    });
  });

  describe('carry-forward: replaceFragment with a zero-measure replacement can orphan a tie', () => {
    it('flags a MISSING_TIE_TARGET warning after a fragment replacement deletes the tie partner measure', () => {
      const score = createEmptyScore({ title: 'S', measures: 2 });
      const track = score.tracks[0];
      const m0 = track.measures[0];
      const m1 = track.measures[1];
      const a: NoteEvent = {
        id: 'a',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: m0.startTick,
        durationTicks: m0.durationTicks,
        velocity: 80,
        voiceId: m0.voices[0].id,
        trackId: track.id,
        tieStart: true,
      };
      const b: NoteEvent = {
        id: 'b',
        pitch: { step: 'C', accidental: 0, octave: 4 },
        startTick: m1.startTick,
        durationTicks: m1.durationTicks,
        velocity: 80,
        voiceId: m1.voices[0].id,
        trackId: track.id,
        tieStop: true,
      };
      const measures: Measure[] = [
        { ...m0, voices: [{ ...m0.voices[0], events: [a] }] },
        { ...m1, voices: [{ ...m1.voices[0], events: [b] }] },
      ];
      const tiedScore: Score = { ...score, tracks: [{ ...track, measures }] };
      // Sanity: the tie is valid before the fragment replacement.
      expect(validateScore(tiedScore).some((i) => i.code === ISSUE_CODES.MISSING_TIE_TARGET)).toBe(
        false,
      );

      // Task 3 review carry-forward: replaceFragment silently accepts a
      // zero-measure replacement (it deletes the overlapping block). Here
      // that deletes measure 1, which held note "b" — orphaning "a"'s tie.
      const range = {
        startTick: m1.startTick,
        endTick: m1.startTick + m1.durationTicks,
        trackIds: [track.id],
      };
      const result = replaceFragment(tiedScore, {
        range,
        ppq: tiedScore.ppq,
        tracks: [{ trackId: track.id, measures: [] }],
      });

      const issues = validateScore(result);
      const warning = issues.find((i) => i.code === ISSUE_CODES.MISSING_TIE_TARGET);
      expect(warning).toBeDefined();
      expect(warning?.objectId).toBe('a');
    });
  });
});

// ---- Test helpers ---------------------------------------------------------

/** Sets the time signature of the first measure of the first track. */
function withTimeSignature(score: Score, timeSignature: Measure['timeSignature']): Score {
  const track = score.tracks[0];
  const measures = [{ ...track.measures[0], timeSignature }, ...track.measures.slice(1)];
  return { ...score, tracks: [{ ...track, measures }, ...score.tracks.slice(1)] };
}

/** Sets the key signature of the first measure of the first track. */
function withKeySignature(score: Score, keySignature: Measure['keySignature']): Score {
  const track = score.tracks[0];
  const measures = [{ ...track.measures[0], keySignature }, ...track.measures.slice(1)];
  return { ...score, tracks: [{ ...track, measures }, ...score.tracks.slice(1)] };
}

/**
 * Replaces the first measure's single voice's events with `events` on the
 * first track. By default also grows the measure's `durationTicks` to fit
 * the given events (so tests can target one rule without incidentally
 * tripping "event outside measure"/"overfull"); pass
 * `{ clampToMeasure: false }` to keep the measure's original duration when a
 * test specifically wants that interaction.
 */
function withSingleVoiceEvents(
  score: Score,
  events: NoteEvent[],
  opts: { clampToMeasure?: boolean } = {},
): Score {
  const clamp = opts.clampToMeasure ?? true;
  const track: Track = score.tracks[0];
  const measure = track.measures[0];
  const durationTicks = clamp
    ? Math.max(measure.durationTicks, ...events.map((e) => e.startTick + e.durationTicks))
    : measure.durationTicks;
  const updatedMeasure: Measure = {
    ...measure,
    durationTicks,
    voices: [{ ...measure.voices[0], events }],
  };
  return {
    ...score,
    tracks: [{ ...track, measures: [updatedMeasure, ...track.measures.slice(1)] }],
  };
}
