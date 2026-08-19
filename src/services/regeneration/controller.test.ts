import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../../domain/score/factory.js';
import { emptySelection } from '../../domain/selection/types.js';
import type { ScoreSelection } from '../../domain/selection/types.js';
import {
  applyCandidate,
  prepareRegenerationRequest,
  prepareRegenerationRequestForRange,
} from './controller.js';
import type { RegenerationCandidate } from '@sudobility/music_types';

function scoreWithMeasures(measureCount = 6) {
  return createEmptyScore({
    title: 'S',
    measures: measureCount,
    tracks: [{ name: 'Piano' }],
  });
}

describe('prepareRegenerationRequest', () => {
  it('throws when the selection has no resolvable tick range', () => {
    const score = scoreWithMeasures();
    expect(() =>
      prepareRegenerationRequest(score, emptySelection(), 'x')
    ).toThrow();
  });

  it('does not report expansion for an already full-measure selection', () => {
    const score = scoreWithMeasures();
    const track = score.tracks[0];
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [track.measures[2].id],
      trackIds: [],
    };

    const request = prepareRegenerationRequest(
      score,
      selection,
      'Make this more dramatic'
    );

    expect(request.expandedToFullMeasures).toBe(false);
    expect(request.range).toEqual({
      startTick: track.measures[2].startTick,
      endTick: track.measures[2].startTick + track.measures[2].durationTicks,
      trackIds: [track.id],
    });
  });

  it('reports expansion for a partial-measure range selection and aligns range to full measures', () => {
    const score = scoreWithMeasures();
    const track = score.tracks[0];
    const measure = track.measures[2];
    const partialRange = {
      startTick: measure.startTick + 10,
      endTick: measure.startTick + 20,
      trackIds: [track.id],
    };
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [],
      trackIds: [],
      range: partialRange,
    };

    const request = prepareRegenerationRequest(score, selection, 'x');

    expect(request.expandedToFullMeasures).toBe(true);
    expect(request.range).toEqual({
      startTick: measure.startTick,
      endTick: measure.startTick + measure.durationTicks,
      trackIds: [track.id],
    });
  });

  it('extracts up to 2 measures of preceding and following context', () => {
    const score = scoreWithMeasures(6);
    const track = score.tracks[0];
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [track.measures[3].id],
      trackIds: [],
    };

    const request = prepareRegenerationRequest(score, selection, 'x');

    expect(
      request.precedingContext.tracks[0].measures.map(m => m.index)
    ).toEqual([1, 2]);
    expect(
      request.followingContext.tracks[0].measures.map(m => m.index)
    ).toEqual([4, 5]);
    expect(
      request.selectedFragment.tracks[0].measures.map(m => m.index)
    ).toEqual([3]);
  });

  it('preceding context is empty (not an error) when the selection starts at measure 0', () => {
    const score = scoreWithMeasures(4);
    const track = score.tracks[0];
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [track.measures[0].id],
      trackIds: [],
    };

    const request = prepareRegenerationRequest(score, selection, 'x');

    expect(request.precedingContext.tracks[0].measures).toEqual([]);
    expect(
      request.followingContext.tracks[0].measures.map(m => m.index)
    ).toEqual([1, 2]);
  });

  it('following context is empty (not an error) when the selection ends at the last measure', () => {
    const score = scoreWithMeasures(4);
    const track = score.tracks[0];
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [track.measures[3].id],
      trackIds: [],
    };

    const request = prepareRegenerationRequest(score, selection, 'x');

    expect(request.followingContext.tracks[0].measures).toEqual([]);
  });

  it('always sets preserveMeasureCount/preserveTimeSignatures/preserveTempoEvents to true', () => {
    const score = scoreWithMeasures();
    const track = score.tracks[0];
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [track.measures[0].id],
      trackIds: [],
    };
    const request = prepareRegenerationRequest(score, selection, 'x');

    expect(request.constraints.preserveMeasureCount).toBe(true);
    expect(request.constraints.preserveTimeSignatures).toBe(true);
    expect(request.constraints.preserveTempoEvents).toBe(true);
  });

  it('pins candidateCount to 1 and allows overriding other constraints', () => {
    const score = scoreWithMeasures();
    const track = score.tracks[0];
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [track.measures[0].id],
      trackIds: [],
    };

    // Was 3 with a `candidateCount` option. Generation is a background job
    // now, so there is nobody present to choose between alternatives when it
    // lands; one result is produced and applied.
    const withDefaults = prepareRegenerationRequest(score, selection, 'x');
    expect(withDefaults.candidateCount).toBe(1);

    const withOverrides = prepareRegenerationRequest(score, selection, 'x', {
      constraints: { preserveMelody: true, maximumPolyphony: 1 },
    });
    expect(withOverrides.candidateCount).toBe(1);
    expect(withOverrides.constraints.preserveMelody).toBe(true);
    expect(withOverrides.constraints.maximumPolyphony).toBe(1);
  });

  it("sets scoreId to the source score's id", () => {
    const score = scoreWithMeasures();
    const track = score.tracks[0];
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [track.measures[0].id],
      trackIds: [],
    };
    const request = prepareRegenerationRequest(score, selection, 'x');
    expect(request.scoreId).toBe(score.id);
  });
});

describe('applyCandidate', () => {
  it("returns a ScoreCommand that replaces the candidate's range with its fragment", () => {
    const score = scoreWithMeasures(3);
    const track = score.tracks[0];
    const measure = track.measures[1];
    const range = {
      startTick: measure.startTick,
      endTick: measure.startTick + measure.durationTicks,
      trackIds: [track.id],
    };

    const replacementNote = {
      id: 'replacement-note',
      pitch: { step: 'G' as const, accidental: 0 as const, octave: 4 },
      startTick: measure.startTick,
      durationTicks: measure.durationTicks,
      velocity: 90,
      voiceId: 'placeholder-voice',
      trackId: 'placeholder-track',
    };
    const candidate: RegenerationCandidate = {
      id: 'candidate-1',
      label: 'Variation 1',
      fragment: {
        range,
        ppq: score.ppq,
        tracks: [
          {
            trackId: track.id,
            measures: [
              {
                ...measure,
                id: 'new-measure',
                voices: [
                  {
                    id: 'new-voice',
                    name: 'Voice 1',
                    events: [replacementNote],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const command = applyCandidate(score, candidate);
    const result = command.execute(score);
    const resultTrack = result.tracks.find(t => t.id === track.id)!;

    expect(resultTrack.measures).toHaveLength(3);
    const replacedMeasure = resultTrack.measures[1];
    expect(replacedMeasure.voices[0].events[0]).toMatchObject({
      trackId: track.id,
      voiceId: replacedMeasure.voices[0].id,
    });

    const undone = command.undo(result);
    expect(undone).toEqual(score);
  });

  it('throws when the candidate references a track absent from the score', () => {
    const score = scoreWithMeasures(1);
    const candidate: RegenerationCandidate = {
      id: 'candidate-1',
      label: 'Variation 1',
      fragment: {
        range: { startTick: 0, endTick: 1, trackIds: ['no-such-track'] },
        ppq: score.ppq,
        tracks: [{ trackId: 'no-such-track', measures: [] }],
      },
    };
    expect(() => applyCandidate(score, candidate)).toThrow();
  });
});

describe('prepareRegenerationRequestForRange', () => {
  it('uses the range verbatim, without expanding to measures', () => {
    const score = scoreWithMeasures();
    const ppq = score.ppq;
    const range = {
      startTick: ppq,
      endTick: ppq * 3,
      trackIds: [score.tracks[0].id],
    };

    const req = prepareRegenerationRequestForRange(score, range, 'brighter', {
      measureAligned: false,
    });

    expect(req.range.startTick).toBe(ppq);
    expect(req.range.endTick).toBe(ppq * 3);
    expect(req.expandedToFullMeasures).toBe(false);
  });

  it('drops preserveMeasureCount for a region that is not measure-aligned', () => {
    const score = scoreWithMeasures();
    const ppq = score.ppq;
    const range = {
      startTick: ppq,
      endTick: ppq * 3,
      trackIds: [score.tracks[0].id],
    };

    const req = prepareRegenerationRequestForRange(score, range, 'x', {
      measureAligned: false,
    });

    expect(req.constraints.preserveMeasureCount).toBeUndefined();
    // The other two never depend on alignment.
    expect(req.constraints.preserveTimeSignatures).toBe(true);
    expect(req.constraints.preserveTempoEvents).toBe(true);
  });

  it('keeps preserveMeasureCount for a measure-aligned region', () => {
    const score = scoreWithMeasures();
    const m = score.tracks[0].measures;
    const range = {
      startTick: m[0].startTick,
      endTick: m[1].startTick + m[1].durationTicks,
      trackIds: [score.tracks[0].id],
    };

    const req = prepareRegenerationRequestForRange(score, range, 'x', {
      measureAligned: true,
    });

    expect(req.constraints.preserveMeasureCount).toBe(true);
  });

  it('defaults to measure-aligned, since every caller but Replace Notes is', () => {
    const score = scoreWithMeasures();
    const m = score.tracks[0].measures;
    const range = {
      startTick: 0,
      endTick: m[0].durationTicks,
      trackIds: [score.tracks[0].id],
    };

    expect(
      prepareRegenerationRequestForRange(score, range, 'x').constraints
        .preserveMeasureCount
    ).toBe(true);
  });

  it('carries style, mood and complexity onto the request', () => {
    const score = scoreWithMeasures();
    const m = score.tracks[0].measures;
    const range = {
      startTick: 0,
      endTick: m[0].durationTicks,
      trackIds: [score.tracks[0].id],
    };

    const req = prepareRegenerationRequestForRange(score, range, 'x', {
      style: 'baroque',
      mood: 'melancholy',
      complexity: 'complex',
    });

    expect(req.style).toBe('baroque');
    expect(req.mood).toBe('melancholy');
    expect(req.complexity).toBe('complex');
  });

  it('always asks for exactly one candidate', () => {
    const score = scoreWithMeasures();
    const m = score.tracks[0].measures;
    const range = {
      startTick: 0,
      endTick: m[0].durationTicks,
      trackIds: [score.tracks[0].id],
    };

    expect(
      prepareRegenerationRequestForRange(score, range, 'x').candidateCount
    ).toBe(1);
  });

  it('still extracts preceding and following context around the range', () => {
    const score = scoreWithMeasures();
    const m = score.tracks[0].measures;
    const range = {
      startTick: m[2].startTick,
      endTick: m[2].startTick + m[2].durationTicks,
      trackIds: [score.tracks[0].id],
    };

    const req = prepareRegenerationRequestForRange(score, range, 'x');

    expect(req.precedingContext.range.endTick).toBe(range.startTick);
    expect(req.followingContext.range.startTick).toBe(range.endTick);
  });
});

describe('prepareRegenerationRequest still snaps', () => {
  it('asks for one candidate too, now that candidates are gone', () => {
    const score = scoreWithMeasures();
    const selection: ScoreSelection = {
      eventIds: [],
      measureIds: [score.tracks[0].measures[1].id],
      trackIds: [],
    };

    expect(
      prepareRegenerationRequest(score, selection, 'x').candidateCount
    ).toBe(1);
  });
});
