import { describe, expect, it } from 'vitest';
import { createEmptyScore } from './factory.js';
import { joinTiedNotes, splitNoteAcrossMeasures, tieChainFor } from './ties.js';
import type { MusicalEvent, NoteEvent, Score } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';

function note(
  overrides: Partial<NoteEvent> &
    Pick<NoteEvent, 'id' | 'startTick' | 'durationTicks'>
): NoteEvent {
  return {
    pitch: { step: 'C', accidental: 0, octave: 4 },
    velocity: 80,
    voiceId: 'v1',
    trackId: 't1',
    ...overrides,
  };
}

describe('splitNoteAcrossMeasures', () => {
  it('returns the note unchanged when no boundary falls inside its span', () => {
    const n = note({ id: 'n1', startTick: 0, durationTicks: 480 });
    expect(splitNoteAcrossMeasures(n, [1920, 3840])).toEqual([n]);
  });

  it('splits a note spanning one boundary into two tied segments', () => {
    const n = note({ id: 'n1', startTick: 1680, durationTicks: 480 }); // crosses tick 1920
    const segments = splitNoteAcrossMeasures(n, [1920]);

    expect(segments).toHaveLength(2);
    const [first, second] = segments;

    expect(first.id).toBe('n1');
    expect(first.startTick).toBe(1680);
    expect(first.durationTicks).toBe(240);
    expect(first.tieStart).toBe(true);
    expect(first.tieStop).toBeUndefined();

    expect(second.startTick).toBe(1920);
    expect(second.durationTicks).toBe(240);
    expect(second.tieStart).toBeUndefined();
    expect(second.tieStop).toBe(true);
    expect(second.id).not.toBe('n1');
  });

  it('preserves an existing incoming tie on the first segment and outgoing tie on the last', () => {
    const n = note({
      id: 'n1',
      startTick: 1680,
      durationTicks: 480,
      tieStop: true,
      tieStart: true,
    });
    const [first, second] = splitNoteAcrossMeasures(n, [1920]);
    expect(first.tieStop).toBe(true); // preserved incoming tie
    expect(first.tieStart).toBe(true); // now ties into `second`
    expect(second.tieStop).toBe(true); // tied from `first`
    expect(second.tieStart).toBe(true); // preserved outgoing tie
  });

  it('middle segments of a note spanning two boundaries are tied on both sides', () => {
    const n = note({ id: 'n1', startTick: 100, durationTicks: 4000 });
    const segments = splitNoteAcrossMeasures(n, [1920, 3840]);
    expect(segments).toHaveLength(3);
    const [, middle] = segments;
    expect(middle.tieStart).toBe(true);
    expect(middle.tieStop).toBe(true);
  });
});

describe('joinTiedNotes', () => {
  it('merges a chain of tied notes into a single note spanning the combined duration', () => {
    const a = note({
      id: 'a',
      startTick: 0,
      durationTicks: 240,
      tieStart: true,
    });
    const b = note({
      id: 'b',
      startTick: 240,
      durationTicks: 240,
      tieStop: true,
    });
    const events: MusicalEvent[] = [a, b];

    const joined = joinTiedNotes(events);
    expect(joined).toHaveLength(1);
    const [merged] = joined as NoteEvent[];
    expect(merged.id).toBe('a');
    expect(merged.startTick).toBe(0);
    expect(merged.durationTicks).toBe(480);
    expect(merged.tieStart).toBeUndefined();
  });

  it('leaves untied notes and rests untouched', () => {
    const a = note({ id: 'a', startTick: 0, durationTicks: 240 });
    const rest: MusicalEvent = {
      id: 'r',
      startTick: 240,
      durationTicks: 240,
      voiceId: 'v1',
      trackId: 't1',
    };
    const events: MusicalEvent[] = [a, rest];

    expect(joinTiedNotes(events)).toEqual([a, rest]);
  });

  it('does not join tied notes of different pitch (a data-integrity edge case, not a valid tie)', () => {
    const a = note({
      id: 'a',
      startTick: 0,
      durationTicks: 240,
      tieStart: true,
    });
    const b = note({
      id: 'b',
      startTick: 240,
      durationTicks: 240,
      tieStop: true,
      pitch: { step: 'D', accidental: 0, octave: 4 },
    });
    const joined = joinTiedNotes([a, b]);
    expect(joined).toHaveLength(2);
  });

  it('joins a three-segment chain into one note', () => {
    const a = note({
      id: 'a',
      startTick: 0,
      durationTicks: 240,
      tieStart: true,
    });
    const b = note({
      id: 'b',
      startTick: 240,
      durationTicks: 240,
      tieStart: true,
      tieStop: true,
    });
    const c = note({
      id: 'c',
      startTick: 480,
      durationTicks: 240,
      tieStop: true,
    });
    const joined = joinTiedNotes([a, b, c]);
    expect(joined).toHaveLength(1);
    expect((joined[0] as NoteEvent).durationTicks).toBe(720);
  });

  it('joins tied chord members by pitch even when another chord member sits between them', () => {
    const c1 = note({
      id: 'c1',
      startTick: 0,
      durationTicks: 240,
      tieStart: true,
    });
    const e1 = note({
      id: 'e1',
      startTick: 0,
      durationTicks: 240,
      tieStart: true,
      pitch: { step: 'E', accidental: 0, octave: 4 },
    });
    const c2 = note({
      id: 'c2',
      startTick: 240,
      durationTicks: 240,
      tieStop: true,
    });
    const e2 = note({
      id: 'e2',
      startTick: 240,
      durationTicks: 240,
      tieStop: true,
      pitch: { step: 'E', accidental: 0, octave: 4 },
    });

    const joined = joinTiedNotes([c1, e1, c2, e2]).filter(isNoteEvent);
    expect(joined.map(n => [n.id, n.durationTicks])).toEqual([
      ['c1', 480],
      ['e1', 480],
    ]);
  });
});

describe('tieChainFor', () => {
  function scoreWithVoiceEvents(events: NoteEvent[]): {
    score: Score;
    trackId: string;
    voiceId: string;
  } {
    const score = createEmptyScore({
      title: 'S',
      measures: 2,
      tracks: [{ name: 'Piano' }],
    });
    const track = score.tracks[0];
    const voiceId = track.measures[0].voices[0].id;
    const measureTicks = track.measures[0].durationTicks;
    const m0Events = events.filter(e => e.startTick < measureTicks);
    const m1Events = events.filter(e => e.startTick >= measureTicks);

    const withVoiceId = (e: NoteEvent) => ({
      ...e,
      voiceId,
      trackId: track.id,
    });

    const built: Score = {
      ...score,
      tracks: [
        {
          ...track,
          measures: [
            {
              ...track.measures[0],
              voices: [
                {
                  ...track.measures[0].voices[0],
                  events: m0Events.map(withVoiceId),
                },
              ],
            },
            {
              ...track.measures[1],
              voices: [
                {
                  ...track.measures[1].voices[0],
                  id: voiceId,
                  name: 'Voice 1',
                  events: m1Events.map(withVoiceId),
                },
              ],
            },
          ],
        },
      ],
    };
    return { score: built, trackId: track.id, voiceId };
  }

  it('returns the full chain of tied notes spanning a measure boundary, given any note in the chain', () => {
    const a = note({
      id: 'a',
      startTick: 1680,
      durationTicks: 240,
      tieStart: true,
    });
    const b = note({
      id: 'b',
      startTick: 1920,
      durationTicks: 240,
      tieStop: true,
    });
    const { score } = scoreWithVoiceEvents([a, b]);

    const chainFromFirst = tieChainFor(score, 'a');
    expect(chainFromFirst.map(n => n.id)).toEqual(['a', 'b']);

    const chainFromSecond = tieChainFor(score, 'b');
    expect(chainFromSecond.map(n => n.id)).toEqual(['a', 'b']);
  });

  it('returns the full chain across a measure boundary built via the real factory + splitNoteAcrossMeasures path, where each measure has its own distinct voice id', () => {
    const score = createEmptyScore({
      title: 'S',
      measures: 2,
      tracks: [{ name: 'Piano' }],
    });
    const track = score.tracks[0];
    const [m0, m1] = track.measures;
    const measureTicks = m0.durationTicks;

    // Sanity check on the premise: createEmptyScore (like the real fixtures) gives
    // each measure its own freshly generated voice id, never a shared one.
    expect(m0.voices[0].id).not.toBe(m1.voices[0].id);

    // A note that spans the measure boundary, split the same way real code would
    // split it (spec §4 utility), landing one segment in each measure's own voice.
    const original = note({
      id: 'n1',
      startTick: measureTicks - 240,
      durationTicks: 480,
    });
    const [seg1, seg2] = splitNoteAcrossMeasures(original, [measureTicks]);

    const scoreWithTie: Score = {
      ...score,
      tracks: [
        {
          ...track,
          measures: [
            {
              ...m0,
              voices: [
                {
                  ...m0.voices[0],
                  events: [
                    { ...seg1, voiceId: m0.voices[0].id, trackId: track.id },
                  ],
                },
              ],
            },
            {
              ...m1,
              voices: [
                {
                  ...m1.voices[0],
                  events: [
                    { ...seg2, voiceId: m1.voices[0].id, trackId: track.id },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(tieChainFor(scoreWithTie, seg1.id).map(n => n.id)).toEqual([
      seg1.id,
      seg2.id,
    ]);
    expect(tieChainFor(scoreWithTie, seg2.id).map(n => n.id)).toEqual([
      seg1.id,
      seg2.id,
    ]);
  });

  it('returns a single-element chain for an untied note', () => {
    const a = note({ id: 'a', startTick: 0, durationTicks: 480 });
    const { score } = scoreWithVoiceEvents([a]);
    expect(tieChainFor(score, 'a').map(n => n.id)).toEqual(['a']);
  });

  it('returns an empty array for an unknown note id', () => {
    const { score } = scoreWithVoiceEvents([]);
    expect(tieChainFor(score, 'missing')).toEqual([]);
  });

  /**
   * A hand-built 2-measure, 2-voice-per-measure score (no factory produces
   * multi-voice measures yet, but spec §25 voice allocation will). Voice 0
   * carries a real tie (a -> b) across the barline; voice 1 independently
   * carries its own real tie (c -> d) at the exact same ticks and pitch,
   * to serve as a worst-case coincidental decoy for voice 0's chain.
   */
  function twoVoiceScoreWithParallelTies(): Score {
    const score = createEmptyScore({
      title: 'S',
      measures: 2,
      tracks: [{ name: 'Piano' }],
    });
    const track = score.tracks[0];
    const [m0, m1] = track.measures;
    const measureTicks = m0.durationTicks;
    const tieStartTick = measureTicks - 240;

    const a = note({
      id: 'a',
      startTick: tieStartTick,
      durationTicks: 240,
      tieStart: true,
      voiceId: 'v0',
      trackId: track.id,
    });
    const c = note({
      id: 'c',
      startTick: tieStartTick,
      durationTicks: 240,
      tieStart: true,
      voiceId: 'v1',
      trackId: track.id,
    });
    const b = note({
      id: 'b',
      startTick: measureTicks,
      durationTicks: 240,
      tieStop: true,
      voiceId: 'v0',
      trackId: track.id,
    });
    const d = note({
      id: 'd',
      startTick: measureTicks,
      durationTicks: 240,
      tieStop: true,
      voiceId: 'v1',
      trackId: track.id,
    });

    const score2: Score = {
      ...score,
      tracks: [
        {
          ...track,
          measures: [
            {
              ...m0,
              voices: [
                { id: 'v0', name: 'Voice 1', events: [a] },
                { id: 'v1', name: 'Voice 2', events: [c] },
              ],
            },
            {
              ...m1,
              // Deliberately list the decoy voice (index 1's partner) before
              // the true-partner voice, and give both measures fresh voice
              // ids per voice-index, matching how a real, non-hand-forced
              // score would be built (see the factory-path test above).
              voices: [
                { id: 'v0-m1', name: 'Voice 1', events: [b] },
                { id: 'v1-m1', name: 'Voice 2', events: [d] },
              ],
            },
          ],
        },
      ],
    };
    return score2;
  }

  it('does not splice a coincidental same-pitch, tie-flagged note from another voice into the chain at a barline', () => {
    const score = twoVoiceScoreWithParallelTies();
    expect(tieChainFor(score, 'a').map(n => n.id)).toEqual(['a', 'b']);
    expect(tieChainFor(score, 'c').map(n => n.id)).toEqual(['c', 'd']);
  });

  it('finds the true partner across a measure boundary even when another voice has a note at the same startTick', () => {
    const score = twoVoiceScoreWithParallelTies();
    const chain = tieChainFor(score, 'a');
    expect(chain).toHaveLength(2);
    expect(chain[1].id).toBe('b'); // not 'd', despite 'd' sharing b's startTick/pitch/tieStop
  });
});
