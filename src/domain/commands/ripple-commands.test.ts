import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import { allNotes } from '../score/queries.js';
import { addNoteCommand, deleteEventsCommand } from './note-commands.js';
import { closeGap, insertWithRippleCommand } from './ripple-commands.js';
import type { Pitch, Score } from '@sudobility/music_types';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

const TWO_TRACKS = [
  { name: 'Lead', instrumentName: 'Piano', clef: 'treble' as const },
  { name: 'Bass', instrumentName: 'Piano', clef: 'bass' as const },
];

/** Fills the first measure of track 0 with four quarter notes. */
function withMelody(score: Score, steps: string[]): Score {
  const track = score.tracks[0];
  return steps.reduce(
    (acc, step, i) =>
      addNoteCommand(
        {
          trackId: track.id,
          measureId: track.measures[0].id,
          voiceIndex: 0,
          pitch: pitch(step),
          startTick: i * score.ppq,
          durationTicks: score.ppq,
        },
        'Add note'
      ).execute(acc),
    score
  );
}

function scoreWithMelody(measures = 4): Score {
  const score = createEmptyScore({
    title: 'Ripple',
    measures,
    tracks: TWO_TRACKS,
  });
  return withMelody(score, ['C', 'D', 'E', 'F']);
}

const onTrack = (score: Score, index: number) =>
  allNotes(score)
    .filter(n => n.trackId === score.tracks[index].id)
    .sort((a, b) => a.startTick - b.startTick);

describe('insertWithRippleCommand', () => {
  it('pushes later notes in the track out of the way', () => {
    const score = scoreWithMelody();
    const track = score.tracks[0];

    const next = insertWithRippleCommand(
      {
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: pitch('G'),
        startTick: score.ppq, // where D currently sits
        durationTicks: score.ppq,
      },
      'Insert note'
    ).execute(score);

    expect(
      onTrack(next, 0)
        .map(n => n.pitch.step)
        .slice(0, 5)
    ).toEqual(['C', 'G', 'D', 'E', 'F']);
  });

  it('keeps every displaced note, rather than dropping the tail', () => {
    const score = scoreWithMelody();
    const before = onTrack(score, 0).length;
    const track = score.tracks[0];

    const next = insertWithRippleCommand(
      {
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: pitch('G'),
        startTick: 0,
        durationTicks: score.ppq,
      },
      'Insert note'
    ).execute(score);

    expect(onTrack(next, 0).length).toBe(before + 1);
  });

  it('leaves other tracks where they were', () => {
    // The whole point of 'active track only': the edited part moves against
    // its accompaniment.
    const score = withMelody(
      createEmptyScore({ title: 'Ripple', measures: 4, tracks: TWO_TRACKS }),
      ['C', 'D', 'E', 'F']
    );
    const bass = score.tracks[1];
    const withBass = addNoteCommand(
      {
        trackId: bass.id,
        measureId: bass.measures[0].id,
        voiceIndex: 0,
        pitch: pitch('C', 2),
        startTick: 0,
        durationTicks: score.ppq,
      },
      'Add note'
    ).execute(score);

    const next = insertWithRippleCommand(
      {
        trackId: withBass.tracks[0].id,
        measureId: withBass.tracks[0].measures[0].id,
        voiceIndex: 0,
        pitch: pitch('G'),
        startTick: 0,
        durationTicks: withBass.ppq,
      },
      'Insert note'
    ).execute(withBass);

    expect(onTrack(next, 1).map(n => n.startTick)).toEqual([0]);
  });

  it('grows every track when content passes the last barline', () => {
    // Measures are per-track but the layout assumes a shared grid, so growing
    // only the edited track would misalign every barline beneath it.
    const score = withMelody(
      createEmptyScore({ title: 'Full', measures: 1, tracks: TWO_TRACKS }),
      ['C', 'D', 'E', 'F']
    );
    const track = score.tracks[0];

    const next = insertWithRippleCommand(
      {
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: pitch('G'),
        startTick: 0,
        durationTicks: score.ppq,
      },
      'Insert note'
    ).execute(score);

    expect(next.tracks[0].measures.length).toBeGreaterThan(1);
    expect(next.tracks[0].measures.length).toBe(next.tracks[1].measures.length);
  });

  it('is undoable back to the original', () => {
    const score = scoreWithMelody();
    const track = score.tracks[0];
    const command = insertWithRippleCommand(
      {
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: pitch('G'),
        startTick: 0,
        durationTicks: score.ppq,
      },
      'Insert note'
    );

    const next = command.execute(score);
    const back = command.undo(next);

    expect(onTrack(back, 0).map(n => n.pitch.step)).toEqual(
      onTrack(score, 0).map(n => n.pitch.step)
    );
  });
});

describe('closeGap', () => {
  it('slides later notes earlier to close the gap', () => {
    // Modelled on the real sequence: a cut removes the notes, then the gap
    // they left is closed. `closeGap` deliberately does not delete anything
    // itself.
    const score = scoreWithMelody();
    const track = score.tracks[0];
    const removed = onTrack(score, 0)[1]; // D, on the second beat
    const afterCut = deleteEventsCommand([removed.id], 'Delete notes').execute(
      score
    );

    const next = closeGap(afterCut, track.id, score.ppq, score.ppq);

    expect(onTrack(next, 0).map(n => n.pitch.step)).toEqual(['C', 'E', 'F']);
    expect(onTrack(next, 0).map(n => n.startTick)).toEqual([
      0,
      score.ppq,
      score.ppq * 2,
    ]);
  });

  it('leaves other tracks alone', () => {
    const score = scoreWithMelody();
    const bass = score.tracks[1];
    const withBass = addNoteCommand(
      {
        trackId: bass.id,
        measureId: bass.measures[0].id,
        voiceIndex: 0,
        pitch: pitch('C', 2),
        startTick: score.ppq * 2,
        durationTicks: score.ppq,
      },
      'Add note'
    ).execute(score);

    const next = closeGap(withBass, withBass.tracks[0].id, 0, withBass.ppq);

    expect(onTrack(next, 1).map(n => n.startTick)).toEqual([withBass.ppq * 2]);
  });

  it('keeps the score its original length', () => {
    // Closing a gap must not drop a bar: that is a structural edit nobody
    // asked for, and it would misalign every other track.
    const score = scoreWithMelody();
    const before = score.tracks.map(t => t.measures.length);
    const next = closeGap(score, score.tracks[0].id, 0, score.ppq);
    expect(next.tracks.map(t => t.measures.length)).toEqual(before);
  });

  it('is a no-op for a zero or negative span', () => {
    const score = scoreWithMelody();
    expect(closeGap(score, score.tracks[0].id, 0, 0)).toBe(score);
    expect(closeGap(score, score.tracks[0].id, 0, -480)).toBe(score);
  });
});
