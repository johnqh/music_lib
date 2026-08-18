import { describe, expect, it } from 'vitest';
import { twoTrackScore, twinkleScore } from '../../test/fixtures.js';
import { playbackPlan, playbackTracks } from './plan.js';

describe('playbackPlan', () => {
  it('emits every sounding note with its id and track', () => {
    const plan = playbackPlan(twinkleScore());
    expect(plan.notes.length).toBeGreaterThan(0);
    for (const note of plan.notes) {
      expect(note.noteId).toBeTruthy();
      expect(note.trackId).toBeTruthy();
      expect(note.midi).toBeGreaterThan(0);
      expect(note.durTicks).toBeGreaterThan(0);
    }
  });

  it('sorts notes by tick', () => {
    const ticks = playbackPlan(twinkleScore()).notes.map((n) => n.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it('carries every track, including silent ones, for mix headroom', () => {
    const score = twoTrackScore();
    expect(playbackPlan(score).tracks).toHaveLength(score.tracks.length);
  });

  it('converts ticks to seconds through the score tempo', () => {
    const score = twinkleScore();
    const plan = playbackPlan(score);
    expect(plan.tempo.ticksToSeconds(0)).toBe(0);
    expect(plan.tempo.ticksToSeconds(score.ppq)).toBeGreaterThan(0);
    // Round trip, which is what seek and position reporting rely on.
    const seconds = plan.tempo.ticksToSeconds(score.ppq * 4);
    expect(Math.round(plan.tempo.secondsToTicks(seconds))).toBe(score.ppq * 4);
  });

  it('marks beat one of each measure as an accent', () => {
    const plan = playbackPlan(twinkleScore());
    expect(plan.clicks.length).toBeGreaterThan(0);
    expect(plan.clicks[0]).toEqual({ tick: 0, accent: true });
    expect(plan.clicks.filter((c) => c.accent).length).toBeGreaterThan(1);
  });

  it('reports the last tick any note ends on', () => {
    const plan = playbackPlan(twinkleScore());
    const last = Math.max(...plan.notes.map((n) => n.tick + n.durTicks));
    expect(plan.durationTicks).toBe(last);
  });

  it('resolves a pitched track to its own program', () => {
    const score = twoTrackScore();
    const track = playbackTracks(score)[0];
    expect(track.isPercussion).toBe(false);
    expect(track.voiceProgram).toBe(score.tracks[0].midiProgram);
    expect(track.voiceName.length).toBeGreaterThan(0);
  });

  it('resolves a percussion track to the kit its program falls in', () => {
    // Kits sit at 0, 8, 16, 24, 25, 32, 40 and 48, so a score can arrive at an
    // address GM defines no kit at. 45 must resolve down to Brush at 40 — and
    // the name must be the kit's, not gmInstrument(40), which is Violin.
    const base = twoTrackScore();
    const score = {
      ...base,
      tracks: base.tracks.map((t, i) =>
        i === 0 ? { ...t, clef: 'percussion' as const, midiProgram: 45 } : t,
      ),
    };
    const track = playbackTracks(score)[0];
    expect(track.isPercussion).toBe(true);
    expect(track.voiceProgram).toBe(40);
    expect(track.voiceName).toBe('Brush Kit');
  });

  it('carries the mix flags a live mix changes', () => {
    const base = twoTrackScore();
    const score = {
      ...base,
      tracks: base.tracks.map((t, i) => (i === 0 ? { ...t, muted: true, volume: 0.25 } : t)),
    };
    const track = playbackTracks(score)[0];
    expect(track.muted).toBe(true);
    expect(track.volume).toBe(0.25);
  });
});
