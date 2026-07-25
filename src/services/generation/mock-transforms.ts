/**
 * Instruction-keyword-driven seeded transforms behind
 * `MockGenerationProvider.regenerateRegion` (spec §11, §12): turns a
 * selected `ScoreFragment` into one candidate fragment per call, styled by
 * keywords found in the regeneration instruction — dramatic (wider range +
 * higher velocity + octave doublings), simplify/thin (longer durations,
 * fewer notes), syncopate (offbeat duration reassignment), darker/minor
 * (mode transform), higher/lower (octave transposition), preserve-melody
 * (keep the first track's content, vary the rest), preserve-harmony (the
 * inverse: keep every other track, vary the first track), and a default
 * rhythmic/melodic variation otherwise.
 *
 * The preserve-melody/preserve-harmony distinction is deliberately
 * phrase-aware, not a bag-of-words match: spec §12's preset "Preserve
 * harmony but change melody" mentions both "harmony" and "melody", but
 * asks for the *opposite* of "Create a variation while preserving the
 * melody" — `pickTransformKind` identifies which noun "preserve"/"keep"
 * actually governs (`PRESERVE_TARGET_PATTERN`) rather than checking for
 * "preserve" and "melody" anywhere in the string.
 */
import { midiToPitch, pitchToMidi } from '../../domain/pitch/pitch';
import { transposeDiatonicOctave } from '../../domain/pitch/transpose';
import type { KeySignature, Measure, MusicalEvent, Pitch } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import type { ScoreFragment } from '../../domain/score/fragment';
import { clampPitchToMidiRange, keyTonicPitchClass, snapPitchToScale } from './music-theory';
import type { ScaleType } from './music-theory';
import type { SeededRng } from './prng';
import type { Step } from './patterns/shared';
import { buildMeasureFromSteps } from './patterns/shared';
import type { RegenerationConstraints } from '@sudobility/music_types';

export type TransformKind =
  | 'dramatic'
  | 'simplify'
  | 'syncopate'
  | 'minor'
  | 'higher'
  | 'lower'
  | 'preserveMelody'
  | 'preserveHarmony'
  | 'default';

/**
 * Matches "preserve"/"preserving"/"keep"/"keeping" immediately governing
 * "melody" or "harmony" (optionally through "the"), e.g. "preserving the
 * melody" or "Preserve harmony". Deliberately requires *immediate*
 * adjacency (only "the"/whitespace may sit between the verb and the noun)
 * so it does not fire on "Preserve **rhythm** but change harmony" — there,
 * "harmony" is the thing being *changed*, not the thing preserve governs,
 * and the gap between "preserve" and "harmony" ("rhythm but change") is
 * far wider than the pattern allows.
 */
const PRESERVE_TARGET_PATTERN = /\b(?:preserv\w*|keep(?:ing)?)\s+(?:the\s+)?(melody|harmony)\b/i;

/**
 * Word-boundary-aware keyword patterns for the rest of `pickTransformKind`.
 * Every alternative is anchored with a leading `\b` so it can only match at
 * the *start* of a word, never embedded partway through an unrelated one
 * (plain `String.includes` has no such notion — `"flower".includes("lower")`
 * is true, `"something".includes("thin")` is true, etc., and both were real
 * false-positive bugs here). Words with common suffixed inflections we still
 * want to catch (e.g. "darker", "simplify", "syncopated") stay leading-`\b`
 * *prefix* matches; words with no such inflection risk of a longer word
 * innocently starting with the same letters right after a boundary (namely
 * "thin" — "think"/"thing" both start with "thin" at a genuine word
 * boundary) get a trailing `\b` too, requiring the whole word.
 */
const DRAMATIC_PATTERN = /\b(?:dramatic|energetic|upbeat)/;
const THIN_WORD_PATTERN = /\bthin\b/;
const SIMPLIFY_STEM_PATTERN = /\bsimpl/;
const SYNCOPATE_STEM_PATTERN = /\bsyncopat/;
const MINOR_PATTERN = /\b(?:dark|minor)/;
const HIGHER_PATTERN = /\bhigher\b/;
const LOWER_PATTERN = /\blower\b/;

/** Maps an instruction's keywords to a transform kind (spec §12's preset instructions covered by "dramatic"/"upbeat" -> dramatic, "simplify"/"thin" -> simplify, etc.). The preserve-target check runs first (see `PRESERVE_TARGET_PATTERN`) since it's the most semantically load-bearing distinction. */
export function pickTransformKind(instruction: string): TransformKind {
  const preserveMatch = PRESERVE_TARGET_PATTERN.exec(instruction);
  if (preserveMatch) {
    return preserveMatch[1].toLowerCase() === 'melody' ? 'preserveMelody' : 'preserveHarmony';
  }

  const s = instruction.toLowerCase();
  if (DRAMATIC_PATTERN.test(s)) return 'dramatic';
  if (THIN_WORD_PATTERN.test(s) || SIMPLIFY_STEM_PATTERN.test(s)) return 'simplify';
  if (SYNCOPATE_STEM_PATTERN.test(s)) return 'syncopate';
  if (MINOR_PATTERN.test(s)) return 'minor';
  if (HIGHER_PATTERN.test(s)) return 'higher';
  if (LOWER_PATTERN.test(s)) return 'lower';
  return 'default';
}

function clampVelocity(v: number): number {
  return Math.max(0, Math.min(127, v));
}

/** Wider range + higher velocity + occasional octave doublings on single-note steps. */
function dramaticTransform(steps: Step[], rng: SeededRng): Step[] {
  return steps.map((step) => {
    if (step.pitches.length === 0) return step;
    const velocity = clampVelocity((step.velocity ?? 80) + 25);
    const pitches =
      step.pitches.length === 1 && rng.next() < 0.35
        ? [step.pitches[0], transposeDiatonicOctave(step.pitches[0], 1)]
        : step.pitches;
    return { ...step, pitches, velocity };
  });
}

/** Merges adjacent step pairs into single longer-duration steps (keeping the first step's pitch content), halving note count. */
function simplifyTransform(steps: Step[]): Step[] {
  const result: Step[] = [];
  for (let i = 0; i < steps.length; i += 2) {
    const a = steps[i];
    const b = steps[i + 1];
    result.push(b ? { pitches: a.pitches, durationTicks: a.durationTicks + b.durationTicks, velocity: a.velocity } : a);
  }
  return result;
}

/** Cyclically reassigns each step's pitch content to the *next* step's original duration — same multiset of durations (so the measure still fills exactly), offbeat feel. */
function syncopateTransform(steps: Step[]): Step[] {
  if (steps.length < 2) return steps;
  const durations = steps.map((s) => s.durationTicks);
  const rotated = [...durations.slice(1), durations[0]];
  return steps.map((step, i) => ({ ...step, durationTicks: rotated[i] }));
}

/** Darkens major-third/sixth/seventh intervals above the key's tonic by a semitone (major -> minor color), respelled in the parallel minor. */
function minorModeTransform(steps: Step[], key: KeySignature): Step[] {
  const tonic = keyTonicPitchClass(key);
  const minorKey: KeySignature = { fifths: key.fifths, mode: 'minor' };
  const darken = (p: Pitch): Pitch => {
    const midi = pitchToMidi(p);
    const interval = (((midi - tonic) % 12) + 12) % 12;
    const lowered = interval === 4 || interval === 9 || interval === 11; // major 3rd, 6th, 7th
    return midiToPitch(lowered ? midi - 1 : midi, minorKey);
  };
  return steps.map((step) => ({ ...step, pitches: step.pitches.map(darken) }));
}

function higherTransform(steps: Step[]): Step[] {
  return steps.map((step) => ({ ...step, pitches: step.pitches.map((p) => transposeDiatonicOctave(p, 1)) }));
}

function lowerTransform(steps: Step[]): Step[] {
  return steps.map((step) => ({ ...step, pitches: step.pitches.map((p) => transposeDiatonicOctave(p, -1)) }));
}

/** Small seeded nudges to pitch (snapped back to the key's scale) and velocity — generic rhythmic/melodic variation. */
function defaultVariationTransform(steps: Step[], rng: SeededRng, key: KeySignature): Step[] {
  const scaleType: ScaleType = key.mode === 'major' ? 'major' : 'naturalMinor';
  return steps.map((step) => ({
    ...step,
    pitches: step.pitches.map((p) => {
      const shift = rng.pick([-1, 0, 0, 0, 1]);
      return shift === 0 ? p : snapPitchToScale(pitchToMidi(p) + shift, key, scaleType);
    }),
    velocity: step.velocity === undefined ? step.velocity : clampVelocity(step.velocity + rng.pick([-5, 0, 5])),
  }));
}

function applyStyleTransform(steps: Step[], kind: TransformKind, rng: SeededRng, key: KeySignature): Step[] {
  switch (kind) {
    case 'dramatic':
      return dramaticTransform(steps, rng);
    case 'simplify':
      return simplifyTransform(steps);
    case 'syncopate':
      return syncopateTransform(steps);
    case 'minor':
      return minorModeTransform(steps, key);
    case 'higher':
      return higherTransform(steps);
    case 'lower':
      return lowerTransform(steps);
    case 'preserveMelody':
      // The melody track itself is routed straight through by transformFragment's
      // `passthrough` flag, bypassing this function entirely — so reaching this case
      // means `steps` belongs to an *accompaniment* track, which should actually vary.
      return defaultVariationTransform(steps, rng, key);
    case 'preserveHarmony':
      // Symmetric to preserveMelody: harmony/accompaniment tracks are routed straight
      // through via `passthrough`, so reaching this case means `steps` belongs to the
      // melody track, which should vary (spec §12: "Preserve harmony but change melody").
      return defaultVariationTransform(steps, rng, key);
    default:
      return defaultVariationTransform(steps, rng, key);
  }
}

/** Applies `constraints.allowedPitchRangeByTrack[trackId]` and `constraints.maximumPolyphony`, when given, to a set of steps. */
function applyConstraints(steps: Step[], trackId: string, constraints: RegenerationConstraints): Step[] {
  const range = constraints.allowedPitchRangeByTrack?.[trackId];
  const maxPolyphony = constraints.maximumPolyphony;
  return steps.map((step) => {
    let pitches = range ? step.pitches.map((p) => clampPitchToMidiRange(p, range)) : step.pitches;
    if (maxPolyphony !== undefined && pitches.length > maxPolyphony) {
      pitches = pitches.slice(0, maxPolyphony);
    }
    return { ...step, pitches };
  });
}

/**
 * Regroups a measure's events into `Step`s: consecutive gaps become rests,
 * and events sharing a start tick become one chord step. Simultaneous
 * events with differing durations (unusual, but not disallowed by the
 * data model) collapse to their longest duration — an acceptable
 * simplification for a mock transform's input reconstruction.
 */
function eventsToSteps(events: MusicalEvent[], measureStart: number, measureEnd: number): Step[] {
  const sorted = [...events].sort((a, b) => a.startTick - b.startTick);
  const steps: Step[] = [];
  let cursor = measureStart;
  let i = 0;

  while (i < sorted.length) {
    const startTick = sorted[i].startTick;
    if (startTick > cursor) {
      steps.push({ pitches: [], durationTicks: startTick - cursor });
      cursor = startTick;
    }
    const group: MusicalEvent[] = [];
    while (i < sorted.length && sorted[i].startTick === cursor) {
      group.push(sorted[i]);
      i += 1;
    }
    const durationTicks = Math.max(...group.map((e) => e.durationTicks));
    const notes = group.filter(isNoteEvent);
    steps.push({ pitches: notes.map((n) => n.pitch), durationTicks, velocity: notes[0]?.velocity });
    cursor += durationTicks;
  }

  if (cursor < measureEnd) {
    steps.push({ pitches: [], durationTicks: measureEnd - cursor });
  }
  return steps;
}

/** Transforms one measure's voices in place (positions/signatures preserved; only voice content changes). */
function transformMeasure(
  measure: Measure,
  trackId: string,
  kind: TransformKind,
  passthrough: boolean,
  constraints: RegenerationConstraints,
  rng: SeededRng,
  key: KeySignature,
): Measure {
  const voices = measure.voices.map((voice) => {
    const originalSteps = eventsToSteps(voice.events, measure.startTick, measure.startTick + measure.durationTicks);
    const styled = passthrough ? originalSteps : applyStyleTransform(originalSteps, kind, rng, key);
    const constrained = applyConstraints(styled, trackId, constraints);
    return buildMeasureFromSteps(constrained, measure, trackId, rng).voices[0];
  });

  return { ...measure, id: rng.id('measure'), voices };
}

/**
 * Builds one regeneration candidate `ScoreFragment` from `selectedFragment`
 * by applying a keyword-picked transform to every measure/voice of every
 * track (fresh ids throughout, via `rng`). `candidateIndex > 0` composes an
 * extra `defaultVariationTransform` pass on top of the primary style so
 * that multiple candidates for the *same* instruction still differ from
 * each other (the primary style transforms — e.g. `higherTransform` — are
 * otherwise pure functions of the input, so every candidate would
 * otherwise be identical).
 *
 * `constraints.preserveMelody` (or a "preserve ... melody" instruction)
 * keeps the first track's content unchanged and varies the rest.
 * `constraints.preserveHarmony` (or a "preserve ... harmony" instruction)
 * is the inverse: the first track (treated as the melody/lead line, the
 * same heuristic used for preserveMelody) varies, every other track is
 * kept unchanged.
 */
export function transformFragment(
  selectedFragment: ScoreFragment,
  instruction: string,
  constraints: RegenerationConstraints,
  rng: SeededRng,
  candidateIndex: number,
): ScoreFragment {
  const kind = constraints.preserveHarmony
    ? 'preserveHarmony'
    : constraints.preserveMelody
      ? 'preserveMelody'
      : pickTransformKind(instruction);
  const melodyTrackId = selectedFragment.tracks[0]?.trackId;
  const key = firstKeySignature(selectedFragment) ?? { fifths: 0, mode: 'major' };

  const tracks = selectedFragment.tracks.map((trackFragment) => {
    const isMelodyTrack = trackFragment.trackId === melodyTrackId;
    const passthrough =
      (kind === 'preserveMelody' && isMelodyTrack) || (kind === 'preserveHarmony' && !isMelodyTrack);

    const measures = trackFragment.measures.map((measure) => {
      let transformed = transformMeasure(measure, trackFragment.trackId, kind, passthrough, constraints, rng, key);
      if (candidateIndex > 0 && !passthrough) {
        transformed = transformMeasure(transformed, trackFragment.trackId, 'default', false, constraints, rng, key);
      }
      return transformed;
    });

    return { trackId: trackFragment.trackId, measures };
  });

  return { range: selectedFragment.range, ppq: selectedFragment.ppq, tracks };
}

function firstKeySignature(fragment: ScoreFragment): KeySignature | undefined {
  for (const track of fragment.tracks) {
    if (track.measures.length > 0) return track.measures[0].keySignature;
  }
  return undefined;
}
