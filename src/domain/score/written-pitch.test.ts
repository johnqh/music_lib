import { describe, expect, it } from 'vitest';
import { createEmptyScore } from './factory.js';
import { addNoteCommand } from '../commands/note-commands.js';
import { allNotes } from './queries.js';
import { soundingPitch, writtenScore } from './written-pitch.js';
import { transposeKeySignature, transposePitch } from '../pitch/transpose.js';
import { pitchToMidi } from '../pitch/pitch.js';
import type { KeySignature, Pitch, Score } from '@sudobility/music_types';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

/** A score whose tracks carry the given GM programs, each with a C4 in bar 1. */
function scoreWithPrograms(programs: number[]): Score {
  const base = createEmptyScore({
    title: 'Written',
    measures: 2,
    tracks: programs.map((_, i) => ({
      name: `T${i}`,
      instrumentName: `T${i}`,
      clef: 'treble' as const,
    })),
  });
  const withPrograms: Score = {
    ...base,
    tracks: base.tracks.map((t, i) => ({ ...t, midiProgram: programs[i] })),
  };
  return withPrograms.tracks.reduce(
    (acc, track) =>
      addNoteCommand(
        {
          trackId: track.id,
          measureId: track.measures[0].id,
          voiceIndex: 0,
          pitch: pitch('C'),
          startTick: 0,
          durationTicks: base.ppq,
        },
        'Add note'
      ).execute(acc),
    withPrograms
  );
}

describe('writtenScore', () => {
  it('moves each track by its own interval', () => {
    // Clarinet (71) reads a tone up, alto sax (65) a major sixth up, piano (0)
    // not at all. One score, three answers.
    const score = scoreWithPrograms([71, 65, 0]);
    const written = writtenScore(score);
    const noteOf = (s: Score, track: number) =>
      allNotes(s).find(n => n.trackId === s.tracks[track].id)!;

    expect(
      pitchToMidi(noteOf(written, 0).pitch) -
        pitchToMidi(noteOf(score, 0).pitch)
    ).toBe(2);
    expect(
      pitchToMidi(noteOf(written, 1).pitch) -
        pitchToMidi(noteOf(score, 1).pitch)
    ).toBe(9);
    expect(pitchToMidi(noteOf(written, 2).pitch)).toBe(
      pitchToMidi(noteOf(score, 2).pitch)
    );
  });

  it('moves the key signature with the pitches, per track', () => {
    const written = writtenScore(scoreWithPrograms([71, 0]));
    expect(written.tracks[0].measures[0].keySignature.fifths).toBe(2); // concert C -> D
    expect(written.tracks[1].measures[0].keySignature.fifths).toBe(0);
  });

  it('returns the identical object when nothing transposes', () => {
    // Not a copy: `computeLayout` is cached by score identity, so a fresh
    // object per render would re-format every VexFlow object every frame.
    const score = scoreWithPrograms([0, 1, 2]);
    expect(writtenScore(score)).toBe(score);
  });

  it('does not modify the score it was given', () => {
    const score = scoreWithPrograms([71]);
    const before = JSON.stringify(score);
    writtenScore(score);
    expect(JSON.stringify(score)).toBe(before);
  });

  it('keeps every event and measure id, so selection survives the toggle', () => {
    const score = scoreWithPrograms([71]);
    const written = writtenScore(score);
    expect(allNotes(written).map(n => n.id)).toEqual(
      allNotes(score).map(n => n.id)
    );
    expect(written.tracks[0].measures.map(m => m.id)).toEqual(
      score.tracks[0].measures.map(m => m.id)
    );
  });
});

describe('soundingPitch', () => {
  it('undoes the written transposition', () => {
    // A clarinettist reading D sounds C.
    const written = pitch('D');
    const sounding = soundingPitch(written, 71, { fifths: 0, mode: 'major' });
    expect(sounding.step).toBe('C');
    expect(sounding.accidental).toBe(0);
  });

  it('leaves a non-transposing instrument alone, object and all', () => {
    const p = pitch('D');
    expect(soundingPitch(p, 0, { fifths: 0, mode: 'major' })).toBe(p);
  });
});

describe('round-trip fidelity', () => {
  /**
   * The measurement the whole architecture rests on: sounding -> written ->
   * sounding is exact in *pitch* and lossy in *spelling*. Pinned as a
   * regression test so a future change to `transposePitch` cannot quietly make
   * the pitch half wrong, which would corrupt scores rather than merely
   * respell them.
   */
  it('never changes the sounding pitch, and changes only spellings', () => {
    let pitchWrong = 0;
    let spellingOnly = 0;
    let total = 0;

    for (const semitones of [2, 7, 9, 14, 21, -12, 12]) {
      for (const fifths of [-7, -5, -3, -1, 0, 1, 3, 5, 7]) {
        const key: KeySignature = { fifths, mode: 'major' };
        const writtenKey = transposeKeySignature(key, semitones);
        for (const step of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const) {
          for (const accidental of [-1, 0, 1]) {
            total += 1;
            const p = { step, accidental, octave: 4 } as unknown as Pitch;
            const w = transposePitch(p, semitones, writtenKey);
            const back = transposePitch(w, -semitones, key);
            if (pitchToMidi(back) !== pitchToMidi(p)) pitchWrong += 1;
            else if (back.step !== p.step || back.accidental !== p.accidental)
              spellingOnly += 1;
          }
        }
      }
    }

    expect({ total, pitchWrong }).toEqual({ total: 1323, pitchWrong: 0 });
    // Recorded, not aspired to: this is why stored notes are never
    // round-tripped through the display.
    expect(spellingOnly).toBe(567);
  });

  it('is exact in both pitch and spelling for naturals', () => {
    // What a user actually enters most of the time.
    for (const semitones of [2, 7, 9, 14, 21, -12, 12]) {
      for (const fifths of [-5, -3, -1, 0, 1, 3, 5]) {
        const key: KeySignature = { fifths, mode: 'major' };
        const writtenKey = transposeKeySignature(key, semitones);
        for (const step of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const) {
          const p = { step, accidental: 0, octave: 4 } as unknown as Pitch;
          const back = transposePitch(
            transposePitch(p, semitones, writtenKey),
            -semitones,
            key
          );
          expect(pitchToMidi(back)).toBe(pitchToMidi(p));
        }
      }
    }
  });
});
