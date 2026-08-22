import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '@sudobility/music_types';
import { createId } from '@sudobility/music_types';
import { midiToPitch } from '@sudobility/music_types';
import type { NoteEvent, Score } from '@sudobility/music_types';
import { scoreToTracker } from './export.js';

/** A score with one note per entry, placed on the first track's first measure. */
function scoreWithNotes(
  notes: Array<{
    midi: number;
    startTick: number;
    durationTicks: number;
    voice?: number;
  }>,
  opts: { tracks?: number; measures?: number } = {}
): Score {
  const base = createEmptyScore({
    title: 'Test',
    measures: opts.measures ?? 1,
    tracks: Array.from({ length: opts.tracks ?? 1 }, (_, i) => ({
      name: `T${i + 1}`,
      instrumentName: 'Acoustic Grand Piano',
      clef: 'treble' as const,
    })),
  });
  const track = base.tracks[0];
  const measure = track.measures[0];
  const byVoice = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const v = n.voice ?? 0;
    if (!byVoice.has(v)) byVoice.set(v, []);
    byVoice.get(v)!.push({
      id: createId(),
      pitch: midiToPitch(n.midi),
      startTick: n.startTick,
      durationTicks: n.durationTicks,
      velocity: 80,
      voiceId: '',
      trackId: track.id,
    });
  }
  const voices = [...byVoice.entries()].map(([i, events]) => {
    const id = measure.voices[i]?.id ?? createId();
    return {
      id,
      name: `Voice ${i + 1}`,
      events: events.map(e => ({ ...e, voiceId: id })),
    };
  });
  return {
    ...base,
    tracks: base.tracks.map((t, i) =>
      i === 0
        ? { ...t, measures: [{ ...measure, voices }, ...t.measures.slice(1)] }
        : t
    ),
  };
}

describe('scoreToTracker', () => {
  it('places a note on the row its tick lands on', () => {
    // ppq 480, rowsPerBeat 4 -> 120 ticks per row. Tick 240 is row 2.
    const score = scoreWithNotes([
      { midi: 60, startTick: 240, durationTicks: 120 },
    ]);
    const { module } = scoreToTracker(score, { format: 'xm' });
    expect(module.patterns[0][2][0].note).toBe(60);
    expect(module.patterns[0][2][0].instrument).toBe(1);
  });

  it('writes a release on the row the note ends', () => {
    const score = scoreWithNotes([
      { midi: 60, startTick: 0, durationTicks: 240 },
    ]);
    const { module } = scoreToTracker(score, { format: 'xm' });
    expect(module.patterns[0][2][0].note).toBe('off');
  });

  it('reports nothing lost for a score that fits', () => {
    const score = scoreWithNotes([
      { midi: 60, startTick: 0, durationTicks: 480 },
    ]);
    const { report } = scoreToTracker(score, { format: 'xm' });
    expect(report).toEqual({
      clampedNotes: 0,
      droppedVoices: 0,
      droppedShortNotes: 0,
      quantisedNotes: 0,
    });
  });

  it('clamps a note below the format range by whole octaves and counts it', () => {
    // MIDI 30 is below MOD's 36. An octave up is 42 — deliberately not 36,
    // because pinning to the boundary would also produce 36 from 24 and the
    // test could not tell the two rules apart.
    const score = scoreWithNotes([
      { midi: 30, startTick: 0, durationTicks: 480 },
    ]);
    const { module, report } = scoreToTracker(score, { format: 'mod' });
    expect(report.clampedNotes).toBe(1);
    expect(module.patterns[0][0][0].note).toBe(42);
  });

  it('clamps a note above the format range by whole octaves', () => {
    // MIDI 96 is above MOD's 71. Two octaves down is 72 — still above — so 60.
    const score = scoreWithNotes([
      { midi: 96, startTick: 0, durationTicks: 480 },
    ]);
    const { module, report } = scoreToTracker(score, { format: 'mod' });
    expect(report.clampedNotes).toBe(1);
    expect(module.patterns[0][0][0].note).toBe(60);
  });

  it('does not clamp the same note in a format that can hold it', () => {
    const score = scoreWithNotes([
      { midi: 24, startTick: 0, durationTicks: 480 },
    ]);
    const { module, report } = scoreToTracker(score, { format: 'it' });
    expect(report.clampedNotes).toBe(0);
    expect(module.patterns[0][0][0].note).toBe(24);
  });

  it('counts a note that does not land on a row', () => {
    // 60 ticks is half a row at ppq 480.
    const score = scoreWithNotes([
      { midi: 60, startTick: 60, durationTicks: 480 },
    ]);
    const { report } = scoreToTracker(score, { format: 'xm' });
    expect(report.quantisedNotes).toBe(1);
  });

  it('drops a note shorter than one row and counts it', () => {
    const score = scoreWithNotes([
      { midi: 60, startTick: 0, durationTicks: 30 },
    ]);
    const { report } = scoreToTracker(score, { format: 'xm' });
    expect(report.droppedShortNotes).toBe(1);
    expect(report.quantisedNotes).toBe(0);
  });

  it('gives each voice its own channel', () => {
    const score = scoreWithNotes([
      { midi: 60, startTick: 0, durationTicks: 480, voice: 0 },
      { midi: 64, startTick: 0, durationTicks: 480, voice: 1 },
    ]);
    const { module, report } = scoreToTracker(score, { format: 'xm' });
    expect(module.channels).toBeGreaterThanOrEqual(2);
    expect(module.patterns[0][0][0].note).toBe(60);
    expect(module.patterns[0][0][1].note).toBe(64);
    expect(report.droppedVoices).toBe(0);
  });

  it('drops voices past the format channel limit and counts them', () => {
    // Five voices on one track cannot fit MOD's four channels.
    const score = scoreWithNotes(
      [0, 1, 2, 3, 4].map(v => ({
        midi: 60 + v,
        startTick: 0,
        durationTicks: 480,
        voice: v,
      }))
    );
    const { module, report } = scoreToTracker(score, { format: 'mod' });
    expect(module.channels).toBe(4);
    expect(report.droppedVoices).toBe(1);
  });

  it('names one instrument slot per track', () => {
    const score = scoreWithNotes(
      [{ midi: 60, startTick: 0, durationTicks: 480 }],
      { tracks: 2 }
    );
    const { module } = scoreToTracker(score, { format: 'xm' });
    expect(module.instruments).toHaveLength(2);
    expect(module.instruments[0]).toEqual({
      index: 1,
      name: 'Acoustic Grand Piano',
    });
  });

  it('reports the format it was asked for', () => {
    const score = scoreWithNotes([
      { midi: 60, startTick: 0, durationTicks: 480 },
    ]);
    expect(scoreToTracker(score, { format: 'xm' }).module.format).toBe('xm');
    expect(scoreToTracker(score, { format: 'mod' }).module.format).toBe('mod');
  });

  it('cuts patterns into 64 rows and orders them in sequence', () => {
    // 8 bars of 4/4 at 16 rows a bar is 128 rows: two full patterns.
    const score = scoreWithNotes(
      [{ midi: 60, startTick: 0, durationTicks: 480 }],
      { measures: 8 }
    );
    const { module } = scoreToTracker(score, { format: 'xm' });
    expect(module.patterns).toHaveLength(2);
    for (const p of module.patterns) expect(p).toHaveLength(64);
    expect(module.order).toEqual([0, 1]);
  });
});

describe('speed and tempo', () => {
  const speedTempoAt = (bpm: number) => {
    const base = createEmptyScore({
      title: 'T',
      measures: 1,
      tracks: [{ name: 'A', instrumentName: 'Piano', clef: 'treble' as const }],
    });
    const score: Score = {
      ...base,
      tempoMap: [{ id: 'tempo-0', tick: 0, bpm }],
    };
    const cell = scoreToTracker(score, { format: 'xm' }).module
      .patterns[0][0][0];
    return { speed: cell.speed, bpm: cell.bpm };
  };

  it('uses speed 6 in the common range, where tempo is the BPM exactly', () => {
    // effectiveBpm(6, 125) === 125 — this is the identity the importer inverts.
    expect(speedTempoAt(125)).toEqual({ speed: 6, bpm: 125 });
  });

  it('raises speed for a slow score so tempo stays a legal byte', () => {
    expect(speedTempoAt(20)).toEqual({ speed: 12, bpm: 40 });
  });

  it('lowers speed for a fast score so tempo stays a legal byte', () => {
    expect(speedTempoAt(400)).toEqual({ speed: 3, bpm: 200 });
  });
});
