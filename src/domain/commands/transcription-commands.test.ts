import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import { allNotes } from '../score/queries.js';
import { pitchToMidi } from '../pitch/pitch.js';
import { addTranscribedTrackCommand } from './transcription-commands.js';
import type { Score } from '@sudobility/music_types';

const base = (): Score =>
  createEmptyScore({
    title: 'Import',
    measures: 4,
    tracks: [{ name: 'Piano', instrumentName: 'Piano', clef: 'treble' as const }],
  });

describe('addTranscribedTrackCommand', () => {
  it('adds a new track and never touches the existing ones', () => {
    // An import must not overwrite work already there.
    const score = base();
    const out = addTranscribedTrackCommand({
      name: 'hum',
      notes: [{ midi: 69, startTick: 0, durationTicks: 480 }],
    }).execute(score);

    expect(out.tracks).toHaveLength(2);
    expect(out.tracks[0]).toEqual(score.tracks[0]);
    expect(out.tracks[1].name).toBe('hum');
  });

  it('writes the notes at their ticks, with the right pitches', () => {
    const out = addTranscribedTrackCommand({
      name: 'hum',
      notes: [
        { midi: 69, startTick: 0, durationTicks: 480 },
        { midi: 72, startTick: 480, durationTicks: 480 },
      ],
    }).execute(base());

    const notes = allNotes(out)
      .filter((n) => n.trackId === out.tracks[1].id)
      .sort((a, b) => a.startTick - b.startTick);
    expect(notes.map((n) => pitchToMidi(n.pitch))).toEqual([69, 72]);
    expect(notes.map((n) => n.startTick)).toEqual([0, 480]);
  });

  it('gives the new track the same measure grid as the score', () => {
    const score = base();
    const out = addTranscribedTrackCommand({ name: 'hum', notes: [] }).execute(score);
    expect(out.tracks[1].measures).toHaveLength(score.tracks[0].measures.length);
  });

  it('drops notes past the end rather than piling them on the last beat', () => {
    // Clamping would misrepresent the recording; dropping is honest.
    const out = addTranscribedTrackCommand({
      name: 'hum',
      notes: [{ midi: 69, startTick: 0, durationTicks: 480 }, { midi: 71, startTick: 9_999_999, durationTicks: 480 }],
    }).execute(base());
    expect(allNotes(out).filter((n) => n.trackId === out.tracks[1].id)).toHaveLength(1);
  });

  it('is one undoable step for the whole import', () => {
    // Hundreds of notes must not cost hundreds of undo presses.
    const score = base();
    const cmd = addTranscribedTrackCommand({
      name: 'hum',
      notes: Array.from({ length: 8 }, (_, i) => ({
        midi: 60 + i,
        startTick: i * 240,
        durationTicks: 240,
      })),
    });
    const imported = cmd.execute(score);
    expect(allNotes(imported).filter((n) => n.trackId === imported.tracks[1].id).length).toBeGreaterThan(0);
    expect(JSON.stringify(cmd.undo(imported))).toBe(JSON.stringify(score));
  });

  it('does nothing to a score with no tracks to take a grid from', () => {
    const empty = { ...base(), tracks: [] };
    expect(addTranscribedTrackCommand({ name: 'hum', notes: [] }).execute(empty).tracks).toEqual([]);
  });
});
