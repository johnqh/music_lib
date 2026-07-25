/**
 * Basic drum-groove patterns (spec §31) on a General MIDI percussion note
 * mapping (channel 10 convention): kick (36), snare (38), closed hi-hat
 * (42). Grooves are built on an eighth-note grid; kick/snare placement is
 * expressed relative to a 4-beat cycle (`beatIndex % 4`), a reasonable
 * "basic groove" simplification for meters that aren't in 4.
 */
import type { Pitch, TimeSignature } from '@sudobility/music_types';
import { midiToPitch } from '../../../domain/pitch/pitch.js';
import { measureDurationTicks, ticksFor } from '../../../domain/time/ticks.js';
import type { Step } from './shared.js';

export type DrumGroove = 'rock' | 'basic';

export type DrumOptions = {
  timeSignature: TimeSignature;
  ppq: number;
  measureCount: number;
  groove: DrumGroove;
};

const KICK_MIDI = 36;
const SNARE_MIDI = 38;
const HIHAT_MIDI = 42;

const KICK_BEATS = new Set([0, 2]);
const SNARE_BEATS = new Set([1, 3]);

function grooveMeasure(measureTicks: number, ppq: number, groove: DrumGroove): Step[] {
  const eighth = ticksFor('eighth', ppq);
  const fullSlots = Math.floor(measureTicks / eighth);
  const remainder = measureTicks - fullSlots * eighth;

  const steps: Step[] = [];
  for (let slot = 0; slot < fullSlots; slot += 1) {
    const isDownbeat = slot % 2 === 0;
    const beatIndex = Math.floor(slot / 2) % 4;
    const pitches: Pitch[] = [];

    if (isDownbeat && KICK_BEATS.has(beatIndex)) pitches.push(midiToPitch(KICK_MIDI));
    if (isDownbeat && SNARE_BEATS.has(beatIndex)) pitches.push(midiToPitch(SNARE_MIDI));
    if (groove === 'rock' || isDownbeat) pitches.push(midiToPitch(HIHAT_MIDI));

    steps.push({ pitches, durationTicks: eighth, velocity: isDownbeat ? 100 : 70 });
  }
  if (remainder > 0) steps.push({ pitches: [], durationTicks: remainder });
  return steps;
}

/** Generates `opts.measureCount` identical measures of a basic drum groove. */
export function generateDrums(opts: DrumOptions): Step[][] {
  const measureTicks = measureDurationTicks(opts.timeSignature, opts.ppq);
  const measure = grooveMeasure(measureTicks, opts.ppq, opts.groove);
  return Array.from({ length: opts.measureCount }, () => measure);
}
