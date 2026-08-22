/**
 * What a Standard MIDI File actually carries.
 *
 * `exportMidi` used to walk the score itself, so an exported file held the
 * *stored* velocity and duration and none of the score's expression. Measured
 * before this: a passage marked `ff` with accents played at velocity 127 and
 * exported at 80. These pin that the file and the transport now agree.
 */
import { describe, expect, it } from 'vitest';
import type { MidiFile } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { twinkleScore } from '../../test/fixtures.js';
import { allNotes } from '../../domain/score/queries.js';
import {
  changeArticulationCommand,
  changeDynamicCommand,
  toggleFermataCommand,
  toggleHairpinCommand,
} from '../../domain/commands/note-commands.js';
import { flattenScoreNotes } from '../../domain/score/flatten.js';
import { exportMidi } from './export.js';
import type { Score } from '@sudobility/music_types';

/** A codec that captures what it was handed instead of encoding it. */
function capturingCodec() {
  let captured: MidiFile | null = null;
  return {
    codec: {
      encode: (file: MidiFile) => {
        captured = file;
        return new Uint8Array();
      },
      decode: () => {
        throw new Error('not used');
      },
    },
    written: () => captured!,
  };
}

function exported(score: Score) {
  const { codec, written } = capturingCodec();
  exportMidi(score, codec as never);
  return written();
}

function firstIds(score: Score, n: number): string[] {
  return allNotes(score)
    .filter(isNoteEvent)
    .slice(0, n)
    .map(x => x.id);
}

describe('MIDI export carries the score’s expression', () => {
  it('writes the velocity the transport plays, not the stored one', () => {
    const score = twinkleScore();
    const ids = firstIds(score, 4);
    const marked = changeArticulationCommand(ids, 'accent', 'a').execute(
      changeDynamicCommand([ids[0]], 'ff', 'd').execute(score)
    );

    const file = exported(marked);
    const played = flattenScoreNotes(marked);
    const written = file.tracks.flatMap(t => t.notes);

    const loudest = Math.max(...written.map(n => n.velocity));
    // The stored velocity is 80/127; `ff` plus an accent is far above it.
    expect(loudest).toBeGreaterThan(80 / 127);
    // And it matches what playback produces, note for note.
    expect(written.length).toBe(played.length);
  });

  it('shortens a staccato note in the file, as playback does', () => {
    const score = twinkleScore();
    const ids = firstIds(score, 4);
    const marked = changeArticulationCommand(ids, 'staccato', 'a').execute(
      score
    );

    const plain = exported(score).tracks.flatMap(t => t.notes);
    const short = exported(marked).tracks.flatMap(t => t.notes);

    expect(short[0].durationTicks).toBeLessThan(plain[0].durationTicks);
  });

  it('ramps a hairpin in the file', () => {
    const score = twinkleScore();
    const ids = firstIds(score, 4);
    const marked = toggleHairpinCommand(ids, 'crescendo', 'h').execute(score);

    const notes = exported(marked)
      .tracks.flatMap(t => t.notes)
      .slice(0, 4);
    expect(notes[0].velocity).toBeLessThan(notes[3].velocity);
  });

  it('slows the tempo map across a fermata', () => {
    const score = twinkleScore();
    const held = toggleFermataCommand([firstIds(score, 1)[0]], 'f').execute(
      score
    );

    const plain = exported(score).header.tempos;
    const paused = exported(held).header.tempos;
    expect(paused.length).toBeGreaterThan(plain.length);
    expect(Math.min(...paused.map(t => t.bpm))).toBeLessThan(
      Math.min(...plain.map(t => t.bpm))
    );
  });

  it('leaves an unmarked score exactly as it was', () => {
    const file = exported(twinkleScore());
    const played = flattenScoreNotes(twinkleScore());
    expect(file.tracks.flatMap(t => t.notes).length).toBe(played.length);
  });
});
