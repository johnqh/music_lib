import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import { validateScore } from '../validation/validator.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent, Pitch, Score } from '@sudobility/music_types';
import { twinkleScore } from '../../test/fixtures.js';
import { allNotes } from '../score/queries.js';
import { ticksFor } from '../time/ticks.js';
import {
  addNoteCommand,
  changeAccidentalCommand,
  changeArticulationCommand,
  changeDurationCommand,
  changePitchCommand,
  changeVelocityCommand,
  changeVoiceCommand,
  deleteEventsCommand,
  moveNotesCommand,
  resizeNotesCommand,
  clearGraceNotesCommand,
  toGraceNoteCommand,
  toggleSlurCommand,
  toggleTieCommand,
} from './note-commands.js';

const PITCH: Pitch = { step: 'C', accidental: 0, octave: 4 };

function baseScore() {
  return createEmptyScore({
    title: 'S',
    measures: 2,
    tracks: [{ name: 'Piano' }],
  });
}

/** Adds a single 480-tick C4 note at startTick 0 of measure 0/voice 0, returning the resulting score. */
function withOneNote(score = baseScore()) {
  const track = score.tracks[0];
  return addNoteCommand(
    {
      trackId: track.id,
      measureId: track.measures[0].id,
      voiceIndex: 0,
      pitch: PITCH,
      startTick: 0,
      durationTicks: 480,
    },
    'Add note'
  ).execute(score);
}

function firstNoteId(score: ReturnType<typeof withOneNote>) {
  const note = score.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
  if (!note) throw new Error('expected a note in measure 0');
  return note.id;
}

/** Builds a score with a genuine tied pair: a note split across the measure 0/1 boundary via moveNotesCommand. */
function withTiedPair() {
  const withNote = withOneNote();
  const noteId = firstNoteId(withNote);
  return moveNotesCommand(
    [noteId],
    {
      deltaTicks: 1800,
      deltaSemitones: 0,
    },
    'Move notes'
  ).execute(withNote);
}

describe('addNoteCommand', () => {
  it('adds a note and backfills the remaining rest, keeping the measure valid', () => {
    const score = baseScore();
    const next = withOneNote(score);

    const events = next.tracks[0].measures[0].voices[0].events;
    expect(events.filter(isNoteEvent)).toHaveLength(1);
    expect(validateScore(next)).toEqual([]);
  });

  it('execute then undo returns a deep-equal score', () => {
    const score = baseScore();
    const track = score.tracks[0];
    const cmd = addNoteCommand(
      {
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: PITCH,
        startTick: 0,
        durationTicks: 480,
      },
      'Add note'
    );
    const next = cmd.execute(score);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('is a no-op when trackId/measureId do not match anything in the score', () => {
    const score = baseScore();
    const cmd = addNoteCommand(
      {
        trackId: 'missing-track',
        measureId: 'missing-measure',
        voiceIndex: 0,
        pitch: PITCH,
        startTick: 0,
        durationTicks: 480,
      },
      'Add note'
    );
    const next = cmd.execute(score);
    expect(next.tracks).toEqual(score.tracks);
  });

  it('replaces (trims) an existing note it overlaps, deterministically', () => {
    const withNote = withOneNote(); // C4 [0, 480)
    const track = withNote.tracks[0];
    const cmd = addNoteCommand(
      {
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: { step: 'G', accidental: 0, octave: 4 },
        startTick: 240,
        durationTicks: 480, // overlaps the existing note's tail half [240, 480) and extends to 720
      },
      'Add note'
    );

    const next = cmd.execute(withNote);
    const notes = next.tracks[0].measures[0].voices[0].events
      .filter(isNoteEvent)
      .sort((a, b) => a.startTick - b.startTick);

    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      startTick: 0,
      durationTicks: 240,
      pitch: PITCH,
    }); // original, trimmed to its surviving head
    expect(notes[1]).toMatchObject({
      startTick: 240,
      durationTicks: 480,
      pitch: { step: 'G', accidental: 0, octave: 4 },
    });
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('replaces (not duplicates) an existing note of the same pitch at the identical span', () => {
    const withNote = withOneNote(); // C4 [0, 480), velocity 80 (the withOneNote default)
    const track = withNote.tracks[0];
    const cmd = addNoteCommand(
      {
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: PITCH, // same pitch as the existing note
        startTick: 0,
        durationTicks: 480, // identical span
        velocity: 42, // distinguishes the new note from the original (velocity 80) once we assert only one survives
      },
      'Add note'
    );

    const next = cmd.execute(withNote);
    const notes =
      next.tracks[0].measures[0].voices[0].events.filter(isNoteEvent);

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      startTick: 0,
      durationTicks: 480,
      pitch: PITCH,
      velocity: 42,
    });
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('truncates (does not split into tied segments) a note that would cross a measure boundary', () => {
    const score = baseScore();
    const track = score.tracks[0];
    const measureTicks = track.measures[0].durationTicks;
    const cmd = addNoteCommand(
      {
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: PITCH,
        startTick: measureTicks - 100,
        durationTicks: 400, // would extend 300 ticks into measure 1
      },
      'Add note'
    );

    const next = cmd.execute(score);
    const m0Notes =
      next.tracks[0].measures[0].voices[0].events.filter(isNoteEvent);
    const m1Notes =
      next.tracks[0].measures[1].voices[0].events.filter(isNoteEvent);

    expect(m0Notes).toHaveLength(1);
    expect(m0Notes[0]).toMatchObject({
      startTick: measureTicks - 100,
      durationTicks: 100,
    });
    expect(m1Notes).toHaveLength(0);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });
});

describe('deleteEventsCommand', () => {
  it('deletes a note and backfills a rest', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = deleteEventsCommand([noteId], 'Delete notes');

    const next = cmd.execute(withNote);
    expect(
      next.tracks[0].measures[0].voices[0].events.filter(isNoteEvent)
    ).toHaveLength(0);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('is a no-op for unknown event ids', () => {
    const withNote = withOneNote();
    const cmd = deleteEventsCommand(['missing'], 'Delete notes');
    expect(cmd.execute(withNote)).toEqual(withNote);
  });

  it('clears a dangling tie on the surviving partner when only one half of a tied pair is deleted', () => {
    const tied = withTiedPair();
    const m0Note =
      tied.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
    const m1Note =
      tied.tracks[0].measures[1].voices[0].events.find(isNoteEvent);
    expect(m0Note?.tieStart).toBe(true);
    expect(m1Note?.tieStop).toBe(true);

    const cmd = deleteEventsCommand([m0Note!.id], 'Delete notes');
    const next = cmd.execute(tied);
    const survivingPartner =
      next.tracks[0].measures[1].voices[0].events.find(isNoteEvent);

    expect(survivingPartner).toBeDefined();
    expect(survivingPartner?.tieStop).toBeUndefined();
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(tied);
  });
});

describe('moveNotesCommand', () => {
  it('moves a note within the same measure by deltaTicks and transposes by deltaSemitones', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = moveNotesCommand(
      [noteId],
      {
        deltaTicks: 240,
        deltaSemitones: 2,
      },
      'Move notes'
    );

    const next = cmd.execute(withNote);
    const moved = next.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
    expect(moved).toMatchObject({
      startTick: 240,
      pitch: { step: 'D', accidental: 0, octave: 4 },
    });
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('splits a note into tied segments when the move crosses a measure boundary', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = moveNotesCommand(
      [noteId],
      {
        deltaTicks: 1800,
        deltaSemitones: 0,
      },
      'Move notes'
    );

    const next = cmd.execute(withNote);
    const m0Notes =
      next.tracks[0].measures[0].voices[0].events.filter(isNoteEvent);
    const m1Notes =
      next.tracks[0].measures[1].voices[0].events.filter(isNoteEvent);

    expect(m0Notes).toHaveLength(1);
    expect(m1Notes).toHaveLength(1);
    expect(m0Notes[0].tieStart).toBe(true);
    expect(m1Notes[0].tieStop).toBe(true);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('clamps movement so a note never moves past the end of the track', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = moveNotesCommand(
      [noteId],
      {
        deltaTicks: 1_000_000,
        deltaSemitones: 0,
      },
      'Move notes'
    );

    const next = cmd.execute(withNote);
    const track = next.tracks[0];
    const trackEnd =
      track.measures[track.measures.length - 1].startTick +
      track.measures[0].durationTicks;
    const notes = track.measures.flatMap(m =>
      m.voices.flatMap(v => v.events.filter(isNoteEvent))
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].startTick + notes[0].durationTicks).toBeLessThanOrEqual(
      trackEnd
    );
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('is a no-op for unknown event ids', () => {
    const withNote = withOneNote();
    const cmd = moveNotesCommand(
      ['missing'],
      {
        deltaTicks: 100,
        deltaSemitones: 1,
      },
      'Move notes'
    );
    expect(cmd.execute(withNote)).toEqual(withNote);
  });

  it('clears a dangling tie on the surviving partner when only one half of a tied pair is moved away', () => {
    const tied = withTiedPair();
    const m0Note =
      tied.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
    expect(m0Note?.tieStart).toBe(true);

    // Move the measure-0 half elsewhere within measure 0, leaving its measure-1 partner behind.
    const cmd = moveNotesCommand(
      [m0Note!.id],
      {
        deltaTicks: -240,
        deltaSemitones: 0,
      },
      'Move notes'
    );
    const next = cmd.execute(tied);
    const survivingPartner =
      next.tracks[0].measures[1].voices[0].events.find(isNoteEvent);

    expect(survivingPartner).toBeDefined();
    expect(survivingPartner?.tieStop).toBeUndefined();
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(tied);
  });

  it('replaces (trims) an existing note it lands on top of, deterministically', () => {
    const score = baseScore();
    const track = score.tracks[0];
    const withTwoNotes = addNoteCommand(
      {
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: { step: 'G', accidental: 0, octave: 4 },
        startTick: 480,
        durationTicks: 480,
      },
      'Add note'
    ).execute(withOneNote(score)); // C4 [0,480), G4 [480,960)
    const gNoteId = withTwoNotes.tracks[0].measures[0].voices[0].events.find(
      e => isNoteEvent(e) && e.pitch.step === 'G'
    )!.id;

    // Move the G4 note left by 240 ticks so it lands overlapping the C4 note's tail.
    const cmd = moveNotesCommand(
      [gNoteId],
      {
        deltaTicks: -240,
        deltaSemitones: 0,
      },
      'Move notes'
    );
    const next = cmd.execute(withTwoNotes);
    const notes = next.tracks[0].measures[0].voices[0].events
      .filter(isNoteEvent)
      .sort((a, b) => a.startTick - b.startTick);

    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      startTick: 0,
      durationTicks: 240,
      pitch: PITCH,
    }); // C4 trimmed to its surviving head
    expect(notes[1]).toMatchObject({
      startTick: 240,
      durationTicks: 480,
      pitch: { step: 'G', accidental: 0, octave: 4 },
    });
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withTwoNotes);
  });
});

describe('resizeNotesCommand', () => {
  it('resizes a note and reflows the rest of the measure', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = resizeNotesCommand([noteId], 960, 'Resize notes');

    const next = cmd.execute(withNote);
    const resized =
      next.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
    expect(resized?.durationTicks).toBe(960);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('clamps a resize that would exceed the measure boundary', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = resizeNotesCommand([noteId], 10_000, 'Resize notes');

    const next = cmd.execute(withNote);
    const resized =
      next.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
    expect(resized?.durationTicks).toBe(
      next.tracks[0].measures[0].durationTicks
    );
    expect(validateScore(next)).toEqual([]);
  });
});

describe('changeDurationCommand', () => {
  it('converts a named duration to ticks using the score ppq', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = changeDurationCommand([noteId], 'half', 'Change duration');

    const next = cmd.execute(withNote);
    const resized =
      next.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
    expect(resized?.durationTicks).toBe(ticksFor('half', withNote.ppq));
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('changePitchCommand', () => {
  it('sets the note pitch and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const newPitch: Pitch = { step: 'G', accidental: 1, octave: 5 };
    const cmd = changePitchCommand([noteId], newPitch, 'Change pitch');

    const next = cmd.execute(withNote);
    expect(
      next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)?.pitch
    ).toEqual(newPitch);
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('changeVelocityCommand', () => {
  it('sets note velocity and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = changeVelocityCommand([noteId], 42, 'Change velocity');

    const next = cmd.execute(withNote);
    expect(
      next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)?.velocity
    ).toBe(42);
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('changeArticulationCommand', () => {
  it('sets an articulation and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = changeArticulationCommand(
      [noteId],
      'staccato',
      'Change articulation'
    );

    const next = cmd.execute(withNote);
    expect(
      next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)
        ?.articulation
    ).toBe('staccato');
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('clears an articulation when given undefined', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const withArticulation = changeArticulationCommand(
      [noteId],
      'accent',
      'Change articulation'
    ).execute(withNote);

    const cmd = changeArticulationCommand(
      [noteId],
      undefined,
      'Change articulation'
    );
    const next = cmd.execute(withArticulation);
    expect(
      next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)
        ?.articulation
    ).toBeUndefined();
    expect(cmd.undo(next)).toEqual(withArticulation);
  });
});

describe('changeAccidentalCommand', () => {
  it('sets pitch accidental, keeping step/octave, and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = changeAccidentalCommand([noteId], 1, 'Change accidental');

    const next = cmd.execute(withNote);
    expect(
      next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)?.pitch
    ).toEqual({
      step: 'C',
      accidental: 1,
      octave: 4,
    });
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('toggleTieCommand', () => {
  it('toggles tieStart on and back off, round-tripping through undo each time', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = toggleTieCommand([noteId], 'tieStart', 'Toggle tie');

    const next = cmd.execute(withNote);
    expect(
      next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)?.tieStart
    ).toBe(true);
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('changeVoiceCommand', () => {
  it('moves a note into a new voice, backfilling both voices, and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = changeVoiceCommand([noteId], 1, 'Change voice');

    const next = cmd.execute(withNote);
    const measure = next.tracks[0].measures[0];
    expect(measure.voices).toHaveLength(2);
    expect(measure.voices[0].events.filter(isNoteEvent)).toHaveLength(0);
    expect(measure.voices[1].events.filter(isNoteEvent)).toHaveLength(1);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('toggleSlurCommand', () => {
  /** Twinkle's first n notes, in tick order. */
  function firstNotes(score: Score, n: number): NoteEvent[] {
    return allNotes(score).filter(isNoteEvent).slice(0, n);
  }

  it('marks the first and last of a selection, and nothing between', () => {
    // A slur is one mark over a run of notes, not a flag on each of them.
    const score = twinkleScore();
    const notes = firstNotes(score, 4);
    const result = toggleSlurCommand(
      notes.map(n => n.id),
      'Slur'
    ).execute(score);
    const after = allNotes(result).filter(isNoteEvent);

    expect(after.find(n => n.id === notes[0].id)?.slurStart).toBe(true);
    expect(after.find(n => n.id === notes[3].id)?.slurStop).toBe(true);
    expect(after.find(n => n.id === notes[1].id)?.slurStart).toBeUndefined();
    expect(after.find(n => n.id === notes[2].id)?.slurStop).toBeUndefined();
  });

  it('picks the endpoints by tick, not by the order they were selected', () => {
    // Shift-clicking around a phrase still selects that phrase.
    const score = twinkleScore();
    const notes = firstNotes(score, 3);
    const shuffled = [notes[2].id, notes[0].id, notes[1].id];
    const after = allNotes(
      toggleSlurCommand(shuffled, 'Slur').execute(score)
    ).filter(isNoteEvent);

    expect(after.find(n => n.id === notes[0].id)?.slurStart).toBe(true);
    expect(after.find(n => n.id === notes[2].id)?.slurStop).toBe(true);
  });

  it('removes a slur it already made, so one control does both', () => {
    const score = twinkleScore();
    const ids = firstNotes(score, 3).map(n => n.id);
    const slurred = toggleSlurCommand(ids, 'Slur').execute(score);
    const cleared = toggleSlurCommand(ids, 'Slur').execute(slurred);

    expect(
      allNotes(cleared)
        .filter(isNoteEvent)
        .some(n => n.slurStart || n.slurStop)
    ).toBe(false);
  });

  it('refuses a single note, which cannot carry a phrase mark', () => {
    const score = twinkleScore();
    const one = firstNotes(score, 1)[0];
    const after = toggleSlurCommand([one.id], 'Slur').execute(score);

    expect(
      allNotes(after)
        .filter(isNoteEvent)
        .some(n => n.slurStart)
    ).toBe(false);
  });

  it('does not join durations the way a tie does', () => {
    // The distinction the two fields exist for: a slur groups different
    // pitches as a phrase and sounds them separately.
    const score = twinkleScore();
    const notes = firstNotes(score, 3);
    const after = toggleSlurCommand(
      notes.map(n => n.id),
      'Slur'
    ).execute(score);
    const durations = allNotes(after)
      .filter(isNoteEvent)
      .slice(0, 3)
      .map(n => n.durationTicks);

    expect(durations).toEqual(notes.map(n => n.durationTicks));
    expect(
      allNotes(after)
        .filter(isNoteEvent)
        .some(n => n.tieStart)
    ).toBe(false);
  });
});

describe('toGraceNoteCommand', () => {
  it('hangs the note off its neighbour and leaves a rest behind', () => {
    // The bar must still add up: an ornament borrows from its principal, it
    // does not shorten the measure.
    const score = twinkleScore();
    const voice = score.tracks[0].measures[0].voices[0];
    const [first, second] = voice.events.filter(isNoteEvent);
    const before = voice.events.reduce((sum, e) => sum + e.durationTicks, 0);

    const after = toGraceNoteCommand(first.id, 'Grace').execute(score);
    const afterVoice = after.tracks[0].measures[0].voices[0];

    expect(afterVoice.events.reduce((sum, e) => sum + e.durationTicks, 0)).toBe(
      before
    );
    expect(isNoteEvent(afterVoice.events[0])).toBe(false); // now a rest
    const principal = afterVoice.events.find(
      e => e.id === second.id
    ) as NoteEvent;
    expect(principal.graceNotes?.[0].pitch).toEqual(first.pitch);
  });

  it('refuses a note with nothing after it to ornament', () => {
    const score = twinkleScore();
    const notes = allNotes(score).filter(isNoteEvent);
    const last = notes[notes.length - 1];
    const after = toGraceNoteCommand(last.id, 'Grace').execute(score);

    expect(allNotes(after).filter(isNoteEvent)).toHaveLength(notes.length);
  });

  it('stacks a second ornament rather than replacing the first', () => {
    const score = twinkleScore();
    const voice = score.tracks[0].measures[0].voices[0];
    const [first, second, third] = voice.events.filter(isNoteEvent);

    let result = toGraceNoteCommand(first.id, 'Grace').execute(score);
    result = toGraceNoteCommand(second.id, 'Grace').execute(result);

    const principal = allNotes(result).find(
      n => n.id === third.id
    ) as NoteEvent;
    expect(principal.graceNotes).toHaveLength(2);
  });

  it('leaves the measure valid', () => {
    const score = twinkleScore();
    const first = allNotes(score).filter(isNoteEvent)[0];
    const after = toGraceNoteCommand(first.id, 'Grace').execute(score);

    expect(validateScore(after).filter(i => i.severity === 'error')).toEqual(
      []
    );
  });
});

describe('clearGraceNotesCommand', () => {
  it('removes every ornament from a note', () => {
    const score = twinkleScore();
    const voice = score.tracks[0].measures[0].voices[0];
    const [first, second] = voice.events.filter(isNoteEvent);
    const withGrace = toGraceNoteCommand(first.id, 'Grace').execute(score);

    const cleared = clearGraceNotesCommand([second.id], 'Clear').execute(
      withGrace
    );
    const principal = allNotes(cleared).find(
      n => n.id === second.id
    ) as NoteEvent;

    expect(principal.graceNotes).toBeUndefined();
  });
});
