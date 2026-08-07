import { describe, expect, it } from 'vitest';
import { modToScore } from './import.js';
import { isNoteEvent } from '@sudobility/music_types';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import type { ModCell, ModFile } from './types.js';
import type { Score } from '@sudobility/music_types';

type CellSpec = { sample?: number; period?: number; effect?: number; param?: number };
const cell = (c: CellSpec): ModCell => ({
  sample: c.sample ?? 0,
  period: c.period ?? 0,
  effect: c.effect ?? 0,
  param: c.param ?? 0,
});

/** A parsed module: `rows[row][channel]`, padded to 64 rows per pattern. */
function mod(opts: { order?: number[]; sampleNames?: string[]; rows?: CellSpec[][] }): ModFile {
  const rows = (opts.rows ?? []).map((r) => r.map(cell));
  while (rows.length < 64) rows.push([cell({}), cell({}), cell({}), cell({})]);
  return {
    title: 'test',
    channels: 4,
    samples: Array.from({ length: 31 }, (_, i) => ({
      index: i + 1,
      name: opts.sampleNames?.[i] ?? '',
    })),
    order: opts.order ?? [0],
    patterns: [rows],
  };
}

const notesOf = (score: Score) =>
  score.tracks.flatMap((t) =>
    t.measures.flatMap((m) =>
      m.voices.flatMap((v) =>
        v.events.filter(isNoteEvent).map((e) => ({
          midi: pitchToMidi(e.pitch),
          startTick: e.startTick,
          trackId: t.id,
        })),
      ),
    ),
  );

describe('modToScore', () => {
  it('puts a note at the right pitch and tick', () => {
    const notes = notesOf(modToScore(mod({ rows: [[{ sample: 1, period: 428 }]] })));
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(48);
    expect(notes[0].startTick).toBe(0);
  });

  it('spaces rows a sixteenth apart', () => {
    const score = modToScore(
      mod({ rows: [[{ sample: 1, period: 428 }], [{ sample: 1, period: 428 }]] }),
    );
    const ticks = notesOf(score).map((n) => n.startTick).sort((a, b) => a - b);
    expect(ticks[1] - ticks[0]).toBe(score.ppq / 4);
  });

  it('groups notes by sample, not by channel', () => {
    // The central mapping decision.
    const score = modToScore(
      mod({
        rows: [[{ sample: 1, period: 428 }, { sample: 2, period: 214 }, { sample: 1, period: 856 }]],
      }),
    );
    expect(score.tracks).toHaveLength(2);
    expect(notesOf(score).filter((n) => n.trackId === score.tracks[0].id)).toHaveLength(2);
  });

  it('puts simultaneous notes from two channels into different voices', () => {
    // A sample-grouped track is not always a single line.
    const score = modToScore(
      mod({ rows: [[{ sample: 1, period: 428 }, { sample: 1, period: 214 }]] }),
    );
    expect(score.tracks).toHaveLength(1);
    const sounding = score.tracks[0].measures[0].voices.filter((v) =>
      v.events.some(isNoteEvent),
    );
    expect(sounding.length).toBeGreaterThanOrEqual(2);
  });

  it('flattens a repeated pattern in the order list', () => {
    const rows = [[{ sample: 1, period: 428 }]];
    const once = notesOf(modToScore(mod({ order: [0], rows })));
    const thrice = notesOf(modToScore(mod({ order: [0, 0, 0], rows })));
    expect(thrice).toHaveLength(once.length * 3);
  });

  it('carries speed changes into the tempo map', () => {
    const score = modToScore(
      mod({ rows: [[{ sample: 1, period: 428 }], [{ effect: 0xf, param: 0x03 }]] }),
    );
    expect(score.tempoMap.length).toBeGreaterThan(1);
    expect(score.tempoMap[1].bpm).toBe(250);
    expect(score.tempoMap[1].tick).toBe(score.ppq / 4);
  });

  it('names a track from its sample, falling back when blank', () => {
    const named = modToScore(mod({ sampleNames: ['bassline'], rows: [[{ sample: 1, period: 428 }]] }));
    expect(named.tracks[0].name).toBe('bassline');
    const blank = modToScore(mod({ rows: [[{ sample: 7, period: 428 }]] }));
    expect(blank.tracks[0].name).toBe('Sample 7');
  });

  it('ignores cells with no note', () => {
    expect(notesOf(modToScore(mod({ rows: [[{}]] })))).toHaveLength(0);
  });

  it('ends a note when its channel plays again', () => {
    // Tracker notes have no length; a channel is monophonic, so the next note
    // on that channel is what stops the previous one.
    const score = modToScore(
      mod({ rows: [[{ sample: 1, period: 428 }], [{ sample: 1, period: 214 }]] }),
    );
    const first = score.tracks[0].measures[0].voices
      .flatMap((v) => v.events)
      .filter(isNoteEvent)
      .sort((a, b) => a.startTick - b.startTick)[0];
    expect(first.durationTicks).toBe(score.ppq / 4);
  });
});
