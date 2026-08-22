import { describe, expect, it } from 'vitest';
import { trackerToScore } from './import.js';
import { isNoteEvent } from '@sudobility/music_types';
import { pitchToMidi } from '@sudobility/music_types';
import { validateScore } from '@sudobility/music_types';
import { allNotes } from '@sudobility/music_types';
import type { TrackerCell, TrackerModule } from './types.js';
import type { Score } from '@sudobility/music_types';

type CellSpec = {
  instrument?: number;
  /** A MIDI note number, `'off'` for a release, omitted for an empty cell. */
  note?: number | 'off';
  speed?: number;
  bpm?: number;
  patternBreak?: boolean;
};

const cell = (c: CellSpec): TrackerCell => ({
  instrument: c.instrument ?? 0,
  note: c.note ?? null,
  ...(c.speed !== undefined ? { speed: c.speed } : {}),
  ...(c.bpm !== undefined ? { bpm: c.bpm } : {}),
  ...(c.patternBreak ? { patternBreak: true } : {}),
});

/** A decoded module: `rows[row][channel]`, padded to 64 rows per pattern. */
function mod(opts: {
  order?: number[];
  sampleNames?: string[];
  rows?: CellSpec[][];
  channels?: number;
}): TrackerModule {
  const channels = opts.channels ?? 4;
  const rows = (opts.rows ?? []).map(r => r.map(cell));
  while (rows.length < 64)
    rows.push(Array.from({ length: channels }, () => cell({})));
  return {
    format: 'mod',
    title: 'test',
    channels,
    instruments: Array.from({ length: 31 }, (_, i) => ({
      index: i + 1,
      name: opts.sampleNames?.[i] ?? '',
    })),
    order: opts.order ?? [0],
    patterns: [rows],
  };
}

const notesOf = (score: Score) =>
  score.tracks.flatMap(t =>
    t.measures.flatMap(m =>
      m.voices.flatMap(v =>
        v.events.filter(isNoteEvent).map(e => ({
          midi: pitchToMidi(e.pitch),
          startTick: e.startTick,
          trackId: t.id,
        }))
      )
    )
  );

describe('trackerToScore', () => {
  it('puts a note at the right pitch and tick', () => {
    const notes = notesOf(
      trackerToScore(mod({ rows: [[{ instrument: 1, note: 48 }]] }))
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(48);
    expect(notes[0].startTick).toBe(0);
  });

  it('spaces rows a sixteenth apart', () => {
    const score = trackerToScore(
      mod({
        rows: [[{ instrument: 1, note: 48 }], [{ instrument: 1, note: 48 }]],
      })
    );
    const ticks = notesOf(score)
      .map(n => n.startTick)
      .sort((a, b) => a - b);
    expect(ticks[1] - ticks[0]).toBe(score.ppq / 4);
  });

  it('groups notes by sample, not by channel', () => {
    // The central mapping decision.
    const score = trackerToScore(
      mod({
        rows: [
          [
            { instrument: 1, note: 48 },
            { instrument: 2, note: 60 },
            { instrument: 1, note: 36 },
          ],
        ],
      })
    );
    expect(score.tracks).toHaveLength(2);
    expect(
      notesOf(score).filter(n => n.trackId === score.tracks[0].id)
    ).toHaveLength(2);
  });

  it('puts simultaneous notes from two channels into different voices', () => {
    // A sample-grouped track is not always a single line.
    const score = trackerToScore(
      mod({
        rows: [
          [
            { instrument: 1, note: 48 },
            { instrument: 1, note: 60 },
          ],
        ],
      })
    );
    expect(score.tracks).toHaveLength(1);
    const sounding = score.tracks[0].measures[0].voices.filter(v =>
      v.events.some(isNoteEvent)
    );
    expect(sounding.length).toBeGreaterThanOrEqual(2);
  });

  it('flattens a repeated pattern in the order list', () => {
    const rows = [[{ instrument: 1, note: 48 }]];
    const once = notesOf(trackerToScore(mod({ order: [0], rows })));
    const thrice = notesOf(trackerToScore(mod({ order: [0, 0, 0], rows })));
    expect(thrice).toHaveLength(once.length * 3);
  });

  it('carries speed changes into the tempo map', () => {
    const score = trackerToScore(
      mod({ rows: [[{ instrument: 1, note: 48 }], [{ speed: 0x03 }]] })
    );
    expect(score.tempoMap.length).toBeGreaterThan(1);
    expect(score.tempoMap[1].bpm).toBe(250);
    expect(score.tempoMap[1].tick).toBe(score.ppq / 4);
  });

  it('names a track from its instrument, falling back when blank', () => {
    const named = trackerToScore(
      mod({ sampleNames: ['bassline'], rows: [[{ instrument: 1, note: 48 }]] })
    );
    expect(named.tracks[0].name).toBe('bassline');
    const blank = trackerToScore(
      mod({ rows: [[{ instrument: 7, note: 48 }]] })
    );
    expect(blank.tracks[0].name).toBe('Instrument 7');
  });

  it('ignores cells with no note', () => {
    expect(notesOf(trackerToScore(mod({ rows: [[{}]] })))).toHaveLength(0);
  });

  it('ends a note when its channel plays again', () => {
    // Tracker notes have no length; a channel is monophonic, so the next note
    // on that channel is what stops the previous one.
    const score = trackerToScore(
      mod({
        rows: [[{ instrument: 1, note: 48 }], [{ instrument: 1, note: 60 }]],
      })
    );
    const first = score.tracks[0].measures[0].voices
      .flatMap(v => v.events)
      .filter(isNoteEvent)
      .sort((a, b) => a.startTick - b.startTick)[0];
    expect(first.durationTicks).toBe(score.ppq / 4);
  });
});

/** A one-pattern, one-channel module from a list of rows. */
function oneChannel(rows: CellSpec[][]): TrackerModule {
  return mod({ rows, channels: 1 });
}

/** Notes on rows 0 and 8, released after each, so rows 2-7 and 10-63 are holes. */
function moduleWithGaps(): TrackerModule {
  const rows: CellSpec[][] = Array.from({ length: 16 }, () => [{}]);
  rows[0] = [{ instrument: 1, note: 60 }];
  rows[1] = [{ note: 'off' }];
  rows[8] = [{ instrument: 1, note: 64 }];
  rows[9] = [{ note: 'off' }];
  return oneChannel(rows);
}

describe('trackerToScore: every voice covers its measure', () => {
  it('produces a score with no underfull bars and no validation errors', () => {
    // The defect this replaces: notes were placed without rests around them, so
    // a bar carrying 1200 ticks of 1920 rendered short. A real module produced
    // 554 such warnings.
    const issues = validateScore(trackerToScore(moduleWithGaps()));
    expect(issues.filter(i => i.code === 'measure-underfull')).toEqual([]);
    expect(issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('still places the notes it was given', () => {
    expect(notesOf(trackerToScore(moduleWithGaps())).length).toBe(2);
  });
});

describe('trackerToScore: note-off', () => {
  it('ends a note at an explicit note-off rather than at the next note', () => {
    const score = trackerToScore(
      oneChannel([[{ instrument: 1, note: 60 }], [{}], [{ note: 'off' }], [{}]])
    );
    const [first] = allNotes(score);
    expect(first.durationTicks).toBe(2 * (score.ppq / 4));
  });

  it('runs a note to the next note when nothing releases it, as MOD does', () => {
    const score = trackerToScore(
      oneChannel([
        [{ instrument: 1, note: 60 }],
        [{}],
        [{}],
        [{ instrument: 1, note: 62 }],
      ])
    );
    const [first] = allNotes(score);
    expect(first.durationTicks).toBe(3 * (score.ppq / 4));
  });
});

describe('trackerToScore: pattern break', () => {
  it('ends a pattern early on Dxx rather than running all 64 rows', () => {
    const broken = trackerToScore(
      oneChannel([
        [{ instrument: 1, note: 60 }],
        [{ patternBreak: true }],
        [{ instrument: 1, note: 62 }],
      ])
    );
    const whole = trackerToScore(
      oneChannel([
        [{ instrument: 1, note: 60 }],
        [{}],
        [{ instrument: 1, note: 62 }],
      ])
    );
    expect(notesOf(broken).length).toBeLessThan(notesOf(whole).length);
  });
});
