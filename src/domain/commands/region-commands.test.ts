import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import { extractFragment } from '../score/fragment.js';
import { validateScore } from '../validation/validator.js';
import { isNoteEvent } from '@sudobility/music_types';
import { importScoreCommand, replaceRegionCommand } from './region-commands.js';

describe('replaceRegionCommand', () => {
  it('replaces only the measures overlapping range, labels by 1-based measure span, and round-trips through undo', () => {
    const score = createEmptyScore({ title: 'S', measures: 4, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const range = {
      startTick: track.measures[1].startTick,
      endTick: track.measures[2].startTick + track.measures[2].durationTicks,
      trackIds: [track.id],
    };

    const fragment = extractFragment(score, range);
    const regeneratedMeasures = fragment.tracks[0].measures.map((m) => ({
      ...m,
      voices: [
        {
          ...m.voices[0],
          events: [
            {
              id: `regen-${m.index}`,
              pitch: { step: 'G' as const, accidental: 0 as const, octave: 4 },
              startTick: m.startTick,
              durationTicks: m.durationTicks,
              velocity: 90,
              voiceId: m.voices[0].id,
              trackId: track.id,
            },
          ],
        },
      ],
    }));
    const newFragment = { ...fragment, tracks: [{ trackId: track.id, measures: regeneratedMeasures }] };

    const cmd = replaceRegionCommand(range, newFragment);
    expect(cmd.label).toBe('Regenerate measures 2–3');

    const next = cmd.execute(score);
    const nextTrack = next.tracks[0];
    expect(nextTrack.measures).toHaveLength(4);
    // Untouched measures 0 and 3 are preserved.
    expect(nextTrack.measures[0].voices[0].events.filter(isNoteEvent)).toHaveLength(0);
    expect(nextTrack.measures[3].voices[0].events.filter(isNoteEvent)).toHaveLength(0);
    // Measures 1 and 2 now carry the regenerated G4 note.
    expect(nextTrack.measures[1].voices[0].events.filter(isNoteEvent)).toHaveLength(1);
    expect(nextTrack.measures[2].voices[0].events.filter(isNoteEvent)).toHaveLength(1);
    expect(validateScore(next)).toEqual([]);

    expect(cmd.undo(next)).toEqual(score);
  });

  it('falls back to a generic label when the fragment has no measures', () => {
    const score = createEmptyScore({ title: 'S', tracks: [{ name: 'Piano' }] });
    const range = { startTick: 0, endTick: 0, trackIds: [] };
    const cmd = replaceRegionCommand(range, { range, ppq: score.ppq, tracks: [] });
    expect(cmd.label).toBe('Regenerate measures');
  });
});

describe('importScoreCommand', () => {
  it('wholesale-replaces the score and round-trips through undo', () => {
    const original = createEmptyScore({ title: 'Original', tracks: [{ name: 'Piano' }] });
    const imported = createEmptyScore({ title: 'Imported', measures: 3, tracks: [{ name: 'Bass' }, { name: 'Drums' }] });

    const cmd = importScoreCommand(imported);
    const next = cmd.execute(original);
    expect(next).toEqual(imported);
    expect(cmd.undo(next)).toEqual(original);
  });
});
