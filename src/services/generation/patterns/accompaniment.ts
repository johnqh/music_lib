/**
 * Chordal accompaniment patterns (spec §31): block chords, Alberti bass,
 * and arpeggios, driven by a chord progression expanded across measures.
 */
import type { KeySignature, Pitch, TimeSignature } from '@sudobility/music_types';
import { pitchToMidi } from '../../../domain/pitch/pitch.js';
import { measureDurationTicks, ticksFor } from '../../../domain/time/ticks.js';
import type { ProgressionName } from '../music-theory.js';
import { expandProgressionToMeasures } from '../music-theory.js';
import type { SeededRng } from '../prng.js';
import type { Step } from './shared.js';

export type AccompanimentStyle = 'blockChords' | 'alberti' | 'arpeggio';

export type AccompanimentOptions = {
  key: KeySignature;
  timeSignature: TimeSignature;
  ppq: number;
  measureCount: number;
  octave: number;
  style: AccompanimentStyle;
  progression: ProgressionName;
  rng: SeededRng;
};

function sortedByPitch(chord: Pitch[]): Pitch[] {
  return [...chord].sort((a, b) => pitchToMidi(a) - pitchToMidi(b));
}

/** Classic Alberti bass: low-high-mid-high, cycling in eighth notes across the measure. */
function albertiPattern(chord: Pitch[], measureTicks: number, ppq: number): Step[] {
  const sorted = sortedByPitch(chord);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const mid = sorted[Math.min(1, sorted.length - 1)];
  const order = [low, high, mid, high];
  const eighth = ticksFor('eighth', ppq);

  const steps: Step[] = [];
  let remaining = measureTicks;
  let i = 0;
  while (remaining > 0) {
    const durationTicks = Math.min(eighth, remaining);
    steps.push({ pitches: [order[i % order.length]], durationTicks });
    remaining -= durationTicks;
    i += 1;
  }
  return steps;
}

/** Ascending broken-chord arpeggio, cycling chord tones in sixteenth notes across the measure. */
function arpeggioPattern(chord: Pitch[], measureTicks: number, ppq: number): Step[] {
  const sorted = sortedByPitch(chord);
  const sixteenth = ticksFor('sixteenth', ppq);

  const steps: Step[] = [];
  let remaining = measureTicks;
  let i = 0;
  while (remaining > 0) {
    const durationTicks = Math.min(sixteenth, remaining);
    steps.push({ pitches: [sorted[i % sorted.length]], durationTicks });
    remaining -= durationTicks;
    i += 1;
  }
  return steps;
}

/**
 * Generates `opts.measureCount` measures of chordal accompaniment in
 * `opts.style`, following `opts.progression` cycled across the measures.
 * `rng` is threaded through for API symmetry with the other pattern
 * generators, though the current styles are deterministic given the chord
 * sequence alone.
 */
export function generateAccompaniment(opts: AccompanimentOptions): Step[][] {
  const measureTicks = measureDurationTicks(opts.timeSignature, opts.ppq);
  const chordsByMeasure = expandProgressionToMeasures(opts.key, opts.progression, opts.measureCount, opts.octave);

  return chordsByMeasure.map((chord) => {
    if (opts.style === 'blockChords') return [{ pitches: chord, durationTicks: measureTicks }];
    if (opts.style === 'alberti') return albertiPattern(chord, measureTicks, opts.ppq);
    return arpeggioPattern(chord, measureTicks, opts.ppq);
  });
}
