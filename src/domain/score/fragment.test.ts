import { describe, expect, it } from 'vitest';
import { createEmptyScore } from './factory.js';
import { extractFragment, replaceFragment } from './fragment.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { Measure, NoteEvent } from '@sudobility/music_types';

describe('extractFragment', () => {
  it('captures the range, score ppq, and per-track measures overlapping the range', () => {
    const score = createEmptyScore({ title: 'S', measures: 3, tracks: [{ name: 'Piano' }] });
    const trackId = score.tracks[0].id;
    const measureTicks = score.tracks[0].measures[0].durationTicks;
    const range = { startTick: measureTicks, endTick: measureTicks * 2, trackIds: [trackId] };

    const fragment = extractFragment(score, range);

    expect(fragment.range).toEqual(range);
    expect(fragment.ppq).toBe(score.ppq);
    expect(fragment.tracks).toHaveLength(1);
    expect(fragment.tracks[0].trackId).toBe(trackId);
    expect(fragment.tracks[0].measures.map((m) => m.index)).toEqual([1]);
    // Extraction shares object identity with the source score (a snapshot, not a deep clone).
    expect(fragment.tracks[0].measures[0]).toBe(score.tracks[0].measures[1]);
  });
});

describe('replaceFragment', () => {
  it('replaces only the measures inside the range, leaving other measures referentially unchanged', () => {
    const score = createEmptyScore({ title: 'S', measures: 3, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const measureTicks = track.measures[0].durationTicks;
    const range = { startTick: measureTicks, endTick: measureTicks * 2, trackIds: [track.id] };

    const replacementNote: NoteEvent = {
      id: 'gen-note',
      pitch: { step: 'G', accidental: 0, octave: 4 },
      startTick: measureTicks,
      durationTicks: measureTicks,
      velocity: 90,
      voiceId: 'placeholder-voice', // deliberately inconsistent with any real voice id
      trackId: 'placeholder-track', // deliberately inconsistent with the real track id
    };
    const replacementMeasure: Measure = {
      ...track.measures[1],
      voices: [{ id: 'new-voice-id', name: 'Voice 1', events: [replacementNote] }],
    };

    const fragment = { range, ppq: score.ppq, tracks: [{ trackId: track.id, measures: [replacementMeasure] }] };
    const result = replaceFragment(score, fragment);
    const resultTrack = result.tracks[0];

    expect(resultTrack.measures).toHaveLength(3);
    // Untouched measures keep their original object identity.
    expect(resultTrack.measures[0]).toBe(track.measures[0]);
    expect(resultTrack.measures[2]).toBe(track.measures[2]);

    // Replaced measure's voices are deep-replaced with the fragment's content...
    const replaced = resultTrack.measures[1];
    expect(replaced.voices).toHaveLength(1);
    const [voice] = replaced.voices;
    expect(voice.id).toBe('new-voice-id');
    const [event] = voice.events;
    expect(isNoteEvent(event)).toBe(true);
    if (isNoteEvent(event)) {
      expect(event.pitch.step).toBe('G');
    }

    // ...but trackId/voiceId are renumbered to match the real track/voice, not the fragment's placeholders.
    expect(event.trackId).toBe(track.id);
    expect(event.voiceId).toBe('new-voice-id');
  });

  it('shifts subsequent measures when the replacement changes measure count', () => {
    const score = createEmptyScore({ title: 'S', measures: 2, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const measureTicks = track.measures[0].durationTicks;
    const range = { startTick: 0, endTick: measureTicks, trackIds: [track.id] };

    // Replace measure 0 with two measures.
    const replacement: Measure[] = [
      { ...track.measures[0], id: 'r0', voices: [{ id: 'rv0', name: 'Voice 1', events: [] }] },
      {
        ...track.measures[0],
        id: 'r1',
        startTick: measureTicks,
        voices: [{ id: 'rv1', name: 'Voice 1', events: [] }],
      },
    ];

    const fragment = { range, ppq: score.ppq, tracks: [{ trackId: track.id, measures: replacement }] };
    const result = replaceFragment(score, fragment);
    const resultTrack = result.tracks[0];

    expect(resultTrack.measures).toHaveLength(3);
    expect(resultTrack.measures.map((m) => m.index)).toEqual([0, 1, 2]);
    // The original second measure now starts after both replacement measures.
    expect(resultTrack.measures[2].startTick).toBe(2 * measureTicks);
  });

  it('leaves a track unchanged (measure-for-measure) if its id is not present in the fragment', () => {
    const score = createEmptyScore({
      title: 'S',
      measures: 2,
      tracks: [{ name: 'A' }, { name: 'B' }],
    });
    const [trackA, trackB] = score.tracks;
    const range = { startTick: 0, endTick: trackA.measures[0].durationTicks, trackIds: [trackA.id] };
    const fragment = { range, ppq: score.ppq, tracks: [{ trackId: trackA.id, measures: [] }] };

    const result = replaceFragment(score, fragment);
    const resultB = result.tracks.find((t) => t.id === trackB.id)!;
    expect(resultB.measures[0]).toBe(trackB.measures[0]);
    expect(resultB.measures[1]).toBe(trackB.measures[1]);
  });

  it('ignores a fragment entry referencing a track id absent from the score', () => {
    const score = createEmptyScore({ title: 'S', measures: 1, tracks: [{ name: 'Piano' }] });
    const fragment = {
      range: { startTick: 0, endTick: 1, trackIds: ['no-such-track'] },
      ppq: score.ppq,
      tracks: [{ trackId: 'no-such-track', measures: [] }],
    };
    const result = replaceFragment(score, fragment);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].measures[0]).toBe(score.tracks[0].measures[0]);
  });
});
