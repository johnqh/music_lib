import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import { addNoteCommand } from './note-commands.js';
import { relocateNotesCommand } from './relocate-commands.js';
import { allNotes } from '../score/queries.js';
import { pitchToMidi } from '../pitch/pitch.js';
import type { Pitch, Score } from '@sudobility/music_types';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

/** Two tracks of `bars` bars. Track 0 gets a note per entry in `steps`, one per beat. */
function scoreWith(steps: string[], bars = 4): Score {
  const base = createEmptyScore({
    title: 'Drag',
    measures: bars,
    tracks: [
      { name: 'A', instrumentName: 'A', clef: 'treble' as const },
      { name: 'B', instrumentName: 'B', clef: 'bass' as const },
    ],
  });
  const track = base.tracks[0];
  return steps.reduce(
    (acc, step, i) =>
      addNoteCommand({
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: pitch(step),
        startTick: i * base.ppq,
        durationTicks: base.ppq,
      }).execute(acc),
    base,
  );
}

const onTrack = (score: Score, index: number) =>
  allNotes(score)
    .filter((n) => n.trackId === score.tracks[index].id)
    .sort((a, b) => a.startTick - b.startTick);

describe('relocateNotesCommand', () => {
  it('moves a note to another track, keeping its sounding pitch', () => {
    // The central claim: you are reassigning who plays it, not rewriting it.
    const score = scoreWith(['C']);
    const note = onTrack(score, 0)[0];
    const out = relocateNotesCommand([note.id], {
      targetTrackId: score.tracks[1].id,
      deltaTicks: 0,
      collision: 'stack',
    }).execute(score);

    expect(onTrack(out, 0)).toHaveLength(0);
    expect(onTrack(out, 1)).toHaveLength(1);
    expect(pitchToMidi(onTrack(out, 1)[0].pitch)).toBe(pitchToMidi(note.pitch));
    expect(onTrack(out, 1)[0].startTick).toBe(note.startTick);
  });

  it('moves within the same track by shifting the tick', () => {
    const score = scoreWith(['C']);
    const note = onTrack(score, 0)[0];
    const out = relocateNotesCommand([note.id], {
      targetTrackId: score.tracks[0].id,
      deltaTicks: score.ppq * 2,
      collision: 'stack',
    }).execute(score);

    expect(onTrack(out, 0)).toHaveLength(1);
    expect(onTrack(out, 0)[0].startTick).toBe(note.startTick + score.ppq * 2);
  });

  it('keeps the internal offsets of a multi-note selection', () => {
    // A phrase keeps its shape.
    const score = scoreWith(['C', 'D', 'E']);
    const notes = onTrack(score, 0);
    const offsets = notes.map((n) => n.startTick - notes[0].startTick);

    const out = relocateNotesCommand(
      notes.map((n) => n.id),
      { targetTrackId: score.tracks[1].id, deltaTicks: score.ppq, collision: 'stack' },
    ).execute(score);

    const moved = onTrack(out, 1);
    expect(moved).toHaveLength(3);
    expect(moved.map((n) => n.startTick - moved[0].startTick)).toEqual(offsets);
    expect(moved[0].startTick).toBe(notes[0].startTick + score.ppq);
  });

  it('lands notes from several tracks all on the target', () => {
    const score = scoreWith(['C', 'D']);
    const first = onTrack(score, 0)[0];
    const onB = relocateNotesCommand([first.id], {
      targetTrackId: score.tracks[1].id,
      deltaTicks: 0,
      collision: 'stack',
    }).execute(score);

    // Now one note on each track; drag both onto track 1.
    const ids = allNotes(onB).map((n) => n.id);
    const out = relocateNotesCommand(ids, {
      targetTrackId: onB.tracks[1].id,
      deltaTicks: 0,
      collision: 'stack',
    }).execute(onB);

    expect(onTrack(out, 0)).toHaveLength(0);
    expect(onTrack(out, 1)).toHaveLength(2);
  });

  describe('collision', () => {
    /** Track 0 has C on beat 0; track 1 has G on beat 0. */
    function twoOccupied(): Score {
      const score = scoreWith(['C']);
      return addNoteCommand({
        trackId: score.tracks[1].id,
        measureId: score.tracks[1].measures[0].id,
        voiceIndex: 0,
        pitch: pitch('G', 3),
        startTick: 0,
        durationTicks: score.ppq,
      }).execute(score);
    }

    it('stack joins what is already there', () => {
      const score = twoOccupied();
      const note = onTrack(score, 0)[0];
      const out = relocateNotesCommand([note.id], {
        targetTrackId: score.tracks[1].id,
        deltaTicks: 0,
        collision: 'stack',
      }).execute(score);
      expect(onTrack(out, 1)).toHaveLength(2);
    });

    it('replace clears the span it lands on', () => {
      const score = twoOccupied();
      const note = onTrack(score, 0)[0];
      const out = relocateNotesCommand([note.id], {
        targetTrackId: score.tracks[1].id,
        deltaTicks: 0,
        collision: 'replace',
      }).execute(score);
      const landed = onTrack(out, 1);
      expect(landed).toHaveLength(1);
      expect(pitchToMidi(landed[0].pitch)).toBe(pitchToMidi(note.pitch));
    });

    it('ripple pushes what was there later', () => {
      const score = twoOccupied();
      const note = onTrack(score, 0)[0];
      const before = onTrack(score, 1)[0];
      const out = relocateNotesCommand([note.id], {
        targetTrackId: score.tracks[1].id,
        deltaTicks: 0,
        collision: 'ripple',
      }).execute(score);

      const landed = onTrack(out, 1);
      expect(landed).toHaveLength(2);
      // The dropped note takes the beat; the occupant moved later.
      const displaced = landed.find((n) => pitchToMidi(n.pitch) === pitchToMidi(before.pitch))!;
      expect(displaced.startTick).toBeGreaterThan(before.startTick);
    });
  });

  it('clamps a drop past the end of the track rather than losing the note', () => {
    const score = scoreWith(['C'], 2);
    const note = onTrack(score, 0)[0];
    const out = relocateNotesCommand([note.id], {
      targetTrackId: score.tracks[1].id,
      deltaTicks: 1_000_000,
      collision: 'stack',
    }).execute(score);

    expect(onTrack(out, 1)).toHaveLength(1);
  });

  it('is a no-op for ids that are not in the score', () => {
    const score = scoreWith(['C']);
    const out = relocateNotesCommand(['nope'], {
      targetTrackId: score.tracks[1].id,
      deltaTicks: 0,
      collision: 'stack',
    }).execute(score);
    expect(JSON.stringify(out)).toBe(JSON.stringify(score));
  });

  it('is a no-op for a target track that does not exist', () => {
    const score = scoreWith(['C']);
    const note = onTrack(score, 0)[0];
    const out = relocateNotesCommand([note.id], {
      targetTrackId: 'nope',
      deltaTicks: 0,
      collision: 'stack',
    }).execute(score);
    expect(JSON.stringify(out)).toBe(JSON.stringify(score));
  });

  it('undoes to exactly the score it started from', () => {
    // One command, one undo step — both the source and the destination.
    const score = scoreWith(['C', 'D']);
    const ids = onTrack(score, 0).map((n) => n.id);
    const cmd = relocateNotesCommand(ids, {
      targetTrackId: score.tracks[1].id,
      deltaTicks: 240,
      collision: 'replace',
    });
    const moved = cmd.execute(score);
    expect(JSON.stringify(cmd.undo(moved))).toBe(JSON.stringify(score));
  });
});
