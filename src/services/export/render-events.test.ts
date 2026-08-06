import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../../domain/score/factory.js';
import { addNoteCommand } from '../../domain/commands/note-commands.js';
import { renderEvents } from './render-events.js';
import type { Pitch, Score } from '@sudobility/music_types';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

/** Two tracks; track 0 has C4 on beat 1, track 1 has G3 on beat 2. */
function twoTrack(): Score {
  const base = createEmptyScore({
    title: 'Render',
    measures: 2,
    tracks: [
      { name: 'A', instrumentName: 'A', clef: 'treble' as const },
      { name: 'B', instrumentName: 'B', clef: 'bass' as const },
    ],
  });
  const withA = addNoteCommand({
    trackId: base.tracks[0].id,
    measureId: base.tracks[0].measures[0].id,
    voiceIndex: 0,
    pitch: pitch('C'),
    startTick: 0,
    durationTicks: base.ppq,
  }).execute(base);
  return addNoteCommand({
    trackId: withA.tracks[1].id,
    measureId: withA.tracks[1].measures[0].id,
    voiceIndex: 0,
    pitch: pitch('G', 3),
    startTick: base.ppq,
    durationTicks: base.ppq,
  }).execute(withA);
}

describe('renderEvents', () => {
  it('turns every sounding note into a timed event', () => {
    const { events } = renderEvents(twoTrack());
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.midi)).toEqual([60, 55]);
  });

  it('places events in seconds, in order', () => {
    // 120bpm default, so a quarter note is half a second.
    const { events } = renderEvents(twoTrack());
    expect(events[0].startSec).toBeCloseTo(0, 5);
    expect(events[1].startSec).toBeCloseTo(0.5, 5);
    expect(events[0].durationSec).toBeCloseTo(0.5, 5);
  });

  it('skips a muted track', () => {
    // An export that ignored mute would not match what you just heard.
    const score = twoTrack();
    const muted: Score = {
      ...score,
      tracks: score.tracks.map((t, i) => (i === 0 ? { ...t, muted: true } : t)),
    };
    expect(renderEvents(muted).events.map((e) => e.midi)).toEqual([55]);
  });

  it('plays only soloed tracks when anything is soloed', () => {
    const score = twoTrack();
    const soloed: Score = {
      ...score,
      tracks: score.tracks.map((t, i) => (i === 0 ? { ...t, solo: true } : t)),
    };
    expect(renderEvents(soloed).events.map((e) => e.midi)).toEqual([60]);
  });

  it('lets solo win over mute on the same track', () => {
    const score = twoTrack();
    const both: Score = {
      ...score,
      tracks: score.tracks.map((t, i) => (i === 0 ? { ...t, solo: true, muted: true } : t)),
    };
    expect(renderEvents(both).events.map((e) => e.midi)).toEqual([60]);
  });

  it('leaves a tail so the last note is not cut off', () => {
    const { events, durationSec } = renderEvents(twoTrack());
    const lastEnd = Math.max(...events.map((e) => e.startSec + e.durationSec));
    expect(durationSec).toBeGreaterThan(lastEnd);
  });

  it('gives an empty score a renderable, non-zero length', () => {
    const empty = createEmptyScore({ title: 'E', measures: 1, tracks: [{ name: 'A' }] });
    const plan = renderEvents(empty);
    expect(plan.events).toEqual([]);
    expect(plan.durationSec).toBeGreaterThan(0);
  });

  it('normalises velocity into 0..1 for the synth', () => {
    for (const e of renderEvents(twoTrack()).events) {
      expect(e.velocity).toBeGreaterThan(0);
      expect(e.velocity).toBeLessThanOrEqual(1);
    }
  });
});
