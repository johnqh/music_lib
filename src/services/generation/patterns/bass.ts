/**
 * Bass-line patterns (spec §31): sustained root notes, and a walking bass
 * that outlines each measure's chord and approaches the next measure's
 * chord by step on the last beat.
 */
import type { KeySignature, Pitch, TimeSignature } from '@sudobility/music_types';
import { midiToPitch, pitchToMidi } from '../../../domain/pitch/pitch';
import { measureDurationTicks, ticksFor } from '../../../domain/time/ticks';
import type { ProgressionName } from '../music-theory';
import { expandProgressionToMeasures, lowestPitch } from '../music-theory';
import type { SeededRng } from '../prng';
import type { Step } from './shared';

export type BassStyle = 'roots' | 'walking';

export type BassOptions = {
  key: KeySignature;
  timeSignature: TimeSignature;
  ppq: number;
  measureCount: number;
  octave: number;
  style: BassStyle;
  progression: ProgressionName;
  rng: SeededRng;
};

/**
 * Quarter-note walking bass for one measure: root on beat 1, a random
 * chord tone on interior beats, and a chromatic approach tone (a step
 * below/above) into `nextChord`'s root on the final beat. The final beat
 * absorbs any remainder when `measureTicks` isn't an exact multiple of a
 * quarter note, so the measure is always filled exactly.
 */
function walkingBassMeasure(
  rng: SeededRng,
  chord: Pitch[],
  nextChord: Pitch[],
  measureTicks: number,
  ppq: number,
  key: KeySignature,
): Step[] {
  const quarter = ticksFor('quarter', ppq);
  const beats = Math.max(1, Math.floor(measureTicks / quarter));
  const chordTones = [...chord].sort((a, b) => pitchToMidi(a) - pitchToMidi(b));
  const root = chordTones[0];
  const nextRoot = lowestPitch(nextChord);

  const steps: Step[] = [];
  let remaining = measureTicks;
  for (let beat = 0; beat < beats; beat += 1) {
    const durationTicks = beat === beats - 1 ? remaining : quarter;
    let pitch: Pitch;
    if (beat === 0) {
      pitch = root;
    } else if (beat === beats - 1 && beats > 1) {
      const approachMidi = pitchToMidi(nextRoot) + rng.pick([-1, 1]);
      pitch = midiToPitch(approachMidi, key);
    } else {
      pitch = rng.pick(chordTones);
    }
    steps.push({ pitches: [pitch], durationTicks });
    remaining -= durationTicks;
  }
  return steps;
}

/**
 * Generates `opts.measureCount` measures of bass in `opts.style`,
 * following `opts.progression` cycled across the measures.
 */
export function generateBass(opts: BassOptions): Step[][] {
  const measureTicks = measureDurationTicks(opts.timeSignature, opts.ppq);
  const chordsByMeasure = expandProgressionToMeasures(opts.key, opts.progression, opts.measureCount, opts.octave);

  return chordsByMeasure.map((chord, index) => {
    if (opts.style === 'roots') return [{ pitches: [lowestPitch(chord)], durationTicks: measureTicks }];
    const nextChord = chordsByMeasure[(index + 1) % chordsByMeasure.length];
    return walkingBassMeasure(opts.rng, chord, nextChord, measureTicks, opts.ppq, opts.key);
  });
}
