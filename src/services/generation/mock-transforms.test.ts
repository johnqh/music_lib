import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../../domain/score/factory';
import { extractFragment } from '../../domain/score/fragment';
import type { RegenerationConstraints } from '@sudobility/music_types';
import { SeededRng } from './prng';
import { pickTransformKind, transformFragment } from './mock-transforms';

const BASE_CONSTRAINTS: RegenerationConstraints = {
  preserveMeasureCount: true,
  preserveTimeSignatures: true,
  preserveTempoEvents: true,
};

function selectedFragmentFor(measureCount = 2) {
  const score = createEmptyScore({ title: 'S', measures: measureCount, tracks: [{ name: 'Piano', clef: 'treble' }] });
  const track = score.tracks[0];
  const measureTicks = track.measures[0].durationTicks;

  // Fill each measure with a simple melody (four quarter notes) so transforms have real content to work with.
  const filled = {
    ...track,
    measures: track.measures.map((measure) => ({
      ...measure,
      voices: [
        {
          id: `${measure.id}-voice`,
          name: 'Voice 1',
          events: [0, 1, 2, 3].map((beat) => ({
            id: `${measure.id}-note-${beat}`,
            pitch: { step: 'C' as const, accidental: 0 as const, octave: 4 },
            startTick: measure.startTick + beat * (measureTicks / 4),
            durationTicks: measureTicks / 4,
            velocity: 80,
            voiceId: `${measure.id}-voice`,
            trackId: track.id,
          })),
        },
      ],
    })),
  };
  const filledScore = { ...score, tracks: [filled] };
  const range = { startTick: 0, endTick: measureTicks * measureCount, trackIds: [track.id] };
  return extractFragment(filledScore, range);
}

describe('pickTransformKind', () => {
  it.each([
    ['Make this more dramatic', 'dramatic'],
    ['Make this more energetic', 'dramatic'],
    ['Make this more upbeat', 'dramatic'],
    ['Simplify this passage', 'simplify'],
    ['Add syncopation', 'syncopate'],
    ['Make this darker', 'minor'],
    ['Make this minor', 'minor'],
    ['Play it higher', 'higher'],
    ['Play it lower', 'lower'],
    ['Create a variation while preserving the melody', 'preserveMelody'],
    ['Add harmonic tension', 'default'],
    // Regression: "harmony" and "melody" can both appear in one instruction; the
    // classifier must key off which noun "preserve"/"keep" actually governs.
    ['Preserve harmony but change melody', 'preserveHarmony'],
    ['Preserve rhythm but change harmony', 'default'], // "harmony" is the thing CHANGED here, not preserved
    ['Keep the harmony, vary the melody', 'preserveHarmony'],
    ['Thin out the orchestration', 'simplify'],
    // Regression: keyword matching must be word-boundary-aware, not plain substring
    // matching — "thin"/"lower" are real English substrings of unrelated words.
    ['Add something interesting to the bassline', 'default'],
    ['Do nothing to the melody', 'default'],
    ['Think of a new rhythm', 'default'],
    ['Add flowery ornamentation', 'default'],
  ] as const)('%s -> %s', (instruction, expected) => {
    expect(pickTransformKind(instruction)).toBe(expected);
  });

  it('does not match "thin" or "lower" embedded inside an unrelated word', () => {
    expect(pickTransformKind('Add something interesting to the bassline')).not.toBe('simplify');
    expect(pickTransformKind('Do nothing to the melody')).not.toBe('simplify');
    expect(pickTransformKind('Think of a new rhythm')).not.toBe('simplify');
    expect(pickTransformKind('Add flowery ornamentation')).not.toBe('lower');
  });

  // spec §12's full preset instruction list: every one must classify to *something*
  // sensible (never throw, never silently invert a preserve-target instruction).
  it.each([
    ['Make this more dramatic', 'dramatic'],
    ['Simplify this passage', 'simplify'],
    ['Add rhythmic variation', 'default'],
    ['Make the melody more memorable', 'default'],
    ['Create a stronger transition', 'default'],
    ['Add harmonic tension', 'default'],
    ['Resolve the phrase', 'default'],
    ['Make this more upbeat', 'dramatic'],
    ['Make this darker', 'minor'],
    ['Create a variation while preserving the melody', 'preserveMelody'],
    ['Preserve rhythm but change harmony', 'default'],
    ['Preserve harmony but change melody', 'preserveHarmony'],
    ['Add accompaniment', 'default'],
    ['Thin out the orchestration', 'simplify'],
  ] as const)('spec §12 preset: %s -> %s', (instruction, expected) => {
    expect(pickTransformKind(instruction)).toBe(expected);
  });
});

describe('transformFragment', () => {
  it('preserves range, ppq, measure count, and time signatures', () => {
    const fragment = selectedFragmentFor(2);
    const rng = new SeededRng('t1');
    const result = transformFragment(fragment, 'Make this more dramatic', BASE_CONSTRAINTS, rng, 0);

    expect(result.range).toEqual(fragment.range);
    expect(result.ppq).toBe(fragment.ppq);
    expect(result.tracks).toHaveLength(fragment.tracks.length);
    result.tracks.forEach((track, i) => {
      expect(track.measures).toHaveLength(fragment.tracks[i].measures.length);
      track.measures.forEach((measure, j) => {
        expect(measure.timeSignature).toEqual(fragment.tracks[i].measures[j].timeSignature);
        expect(measure.startTick).toBe(fragment.tracks[i].measures[j].startTick);
        expect(measure.durationTicks).toBe(fragment.tracks[i].measures[j].durationTicks);
      });
    });
  });

  it('every measure still sums to exactly its own duration after transformation', () => {
    const fragment = selectedFragmentFor(2);
    const rng = new SeededRng('t2');
    const result = transformFragment(fragment, 'Add rhythmic variation', BASE_CONSTRAINTS, rng, 0);
    for (const track of result.tracks) {
      for (const measure of track.measures) {
        for (const voice of measure.voices) {
          const covered = voice.events.reduce((sum, e) => sum + e.durationTicks, 0);
          expect(covered).toBe(measure.durationTicks);
        }
      }
    }
  });

  it('regenerates measure/voice/event ids (never reuses the original selection\'s ids)', () => {
    const fragment = selectedFragmentFor(1);
    const originalEventIds = new Set(fragment.tracks[0].measures[0].voices[0].events.map((e) => e.id));
    const rng = new SeededRng('t3');
    const result = transformFragment(fragment, 'Simplify this passage', BASE_CONSTRAINTS, rng, 0);
    const newEventIds = result.tracks[0].measures[0].voices[0].events.map((e) => e.id);
    expect(newEventIds.some((id) => originalEventIds.has(id))).toBe(false);
  });

  it('is deterministic for the same instruction/seed/candidate index', () => {
    const fragment = selectedFragmentFor(2);
    const a = transformFragment(fragment, 'Make this more dramatic', BASE_CONSTRAINTS, new SeededRng('same'), 0);
    const b = transformFragment(fragment, 'Make this more dramatic', BASE_CONSTRAINTS, new SeededRng('same'), 0);
    expect(a).toEqual(b);
  });

  it('produces distinct fragments for each named variation style', () => {
    const fragment = selectedFragmentFor(2);
    const instructions = {
      energetic: 'Make this more energetic',
      simpler: 'Simplify this passage',
      syncopated: 'Add syncopation',
      higher: 'Play it higher',
      lower: 'Play it lower',
      minor: 'Make this darker',
    };

    const results = Object.fromEntries(
      Object.entries(instructions).map(([label, instruction]) => [
        label,
        transformFragment(fragment, instruction, BASE_CONSTRAINTS, new SeededRng(`style-${label}`), 0),
      ]),
    );

    const labels = Object.keys(results);
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        expect(results[labels[i]]).not.toEqual(results[labels[j]]);
      }
      // Also distinct from the untransformed original.
      expect(results[labels[i]]).not.toEqual(fragment);
    }
  });

  it('higher/lower transforms actually shift pitches by an octave', () => {
    const fragment = selectedFragmentFor(1);
    const higher = transformFragment(fragment, 'Play it higher', BASE_CONSTRAINTS, new SeededRng('h'), 0);
    const lower = transformFragment(fragment, 'Play it lower', BASE_CONSTRAINTS, new SeededRng('l'), 0);

    const originalOctave = fragment.tracks[0].measures[0].voices[0].events[0];
    const higherEvent = higher.tracks[0].measures[0].voices[0].events.find((e) => 'pitch' in e)!;
    const lowerEvent = lower.tracks[0].measures[0].voices[0].events.find((e) => 'pitch' in e)!;

    expect('pitch' in originalOctave && originalOctave.pitch.octave).toBe(4);
    expect('pitch' in higherEvent && higherEvent.pitch.octave).toBe(5);
    expect('pitch' in lowerEvent && lowerEvent.pitch.octave).toBe(3);
  });

  function twoTrackFragment() {
    const score = createEmptyScore({
      title: 'S',
      measures: 2,
      tracks: [
        { name: 'Melody', clef: 'treble' },
        { name: 'Accompaniment', clef: 'treble' },
      ],
    });
    const melodyTrack = score.tracks[0];
    const accompTrack = score.tracks[1];
    const measureTicks = melodyTrack.measures[0].durationTicks;

    // Multiple distinct-pitch notes per measure/track, so a variation transform that
    // only changes *some* notes probabilistically is still overwhelmingly likely to
    // produce a detectable difference (avoids test flakiness from a single-note fixture).
    const pitches: Array<{ step: 'C' | 'D' | 'E' | 'F'; octave: number }> = [
      { step: 'C', octave: 4 },
      { step: 'D', octave: 4 },
      { step: 'E', octave: 4 },
      { step: 'F', octave: 4 },
    ];

    const fill = (track: typeof melodyTrack) => ({
      ...track,
      measures: track.measures.map((measure) => ({
        ...measure,
        voices: [
          {
            id: `${measure.id}-v`,
            name: 'Voice 1',
            events: pitches.map((p, i) => ({
              id: `${measure.id}-n${i}`,
              pitch: { step: p.step, accidental: 0 as const, octave: p.octave },
              startTick: measure.startTick + i * (measureTicks / pitches.length),
              durationTicks: measureTicks / pitches.length,
              velocity: 80,
              voiceId: `${measure.id}-v`,
              trackId: track.id,
            })),
          },
        ],
      })),
    });

    const filledScore = { ...score, tracks: [fill(melodyTrack), fill(accompTrack)] };
    const range = { startTick: 0, endTick: measureTicks * 2, trackIds: [melodyTrack.id, accompTrack.id] };
    return { fragment: extractFragment(filledScore, range), melodyTrackId: melodyTrack.id, accompTrackId: accompTrack.id };
  }

  function pitchesOf(fragment: ReturnType<typeof twoTrackFragment>['fragment'], trackId: string) {
    const track = fragment.tracks.find((t) => t.trackId === trackId)!;
    return track.measures.flatMap((m) => m.voices.flatMap((v) => v.events.map((e) => ('pitch' in e ? e.pitch : null))));
  }

  it('preserveMelody keeps the first track unchanged while actually varying the other tracks', () => {
    const { fragment, melodyTrackId, accompTrackId } = twoTrackFragment();

    const result = transformFragment(
      fragment,
      'Create a variation while preserving the melody',
      { ...BASE_CONSTRAINTS, preserveMelody: true },
      new SeededRng('preserve-melody'),
      0,
    );

    expect(pitchesOf(result, melodyTrackId)).toEqual(pitchesOf(fragment, melodyTrackId));
    expect(pitchesOf(result, accompTrackId)).not.toEqual(pitchesOf(fragment, accompTrackId));
  });

  it('preserveHarmony (constraint) keeps every other track unchanged while actually varying the first (melody) track', () => {
    const { fragment, melodyTrackId, accompTrackId } = twoTrackFragment();

    const result = transformFragment(
      fragment,
      'Preserve harmony but change melody',
      { ...BASE_CONSTRAINTS, preserveHarmony: true },
      new SeededRng('preserve-harmony'),
      0,
    );

    expect(pitchesOf(result, accompTrackId)).toEqual(pitchesOf(fragment, accompTrackId));
    expect(pitchesOf(result, melodyTrackId)).not.toEqual(pitchesOf(fragment, melodyTrackId));
  });

  it('"Preserve harmony but change melody" instruction alone (no explicit constraint) has the same effect', () => {
    const { fragment, melodyTrackId, accompTrackId } = twoTrackFragment();

    const result = transformFragment(fragment, 'Preserve harmony but change melody', BASE_CONSTRAINTS, new SeededRng('preserve-harmony-2'), 0);

    expect(pitchesOf(result, accompTrackId)).toEqual(pitchesOf(fragment, accompTrackId));
    expect(pitchesOf(result, melodyTrackId)).not.toEqual(pitchesOf(fragment, melodyTrackId));
  });

  it('respects allowedPitchRangeByTrack and maximumPolyphony constraints', () => {
    const fragment = selectedFragmentFor(1);
    const trackId = fragment.tracks[0].trackId;
    const constraints: RegenerationConstraints = {
      ...BASE_CONSTRAINTS,
      allowedPitchRangeByTrack: { [trackId]: { lowestMidi: 72, highestMidi: 84 } },
      maximumPolyphony: 1,
    };
    const result = transformFragment(fragment, 'Make this more dramatic', constraints, new SeededRng('range'), 0);

    for (const measure of result.tracks[0].measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if ('pitch' in event) {
            const midi = 60 + (event.pitch.octave - 4) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[event.pitch.step] + event.pitch.accidental;
            expect(midi).toBeGreaterThanOrEqual(72);
            expect(midi).toBeLessThanOrEqual(84);
          }
        }
        // maximumPolyphony 1: no two events sharing a startTick.
        const startTicks = voice.events.map((e) => e.startTick);
        expect(new Set(startTicks).size).toBe(startTicks.length);
      }
    }
  });
});
