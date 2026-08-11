/**
 * Separated stems → a multi-track score.
 *
 * Source separation splits a mix into a fixed set of stems; each one is then
 * heard on its own and becomes a track. This is the part that decides *what
 * instrument a stem is*, which is a musical judgement rather than a signal one,
 * so it lives here and not beside whichever service did the separating.
 *
 * The stems are fixed, and so is the honesty about them: Demucs-family models
 * emit vocals/drums/bass/other, or six with guitar and piano split out of
 * "other". That is not per-instrument transcription — a horn section, strings
 * and a synth pad all arrive together in `other`, and nothing downstream can
 * take them apart again. Six recognisable parts is the ceiling, against the one
 * dense part a whole mix used to produce.
 */
import type { StemKind } from '@sudobility/music_types';
import type { DrumHit } from './drums.js';
import type { TranscribedNote } from './transcribe.js';

export type { StemKind };

/** What a stem becomes on the score. */
export type StemInstrument = {
  name: string;
  /** A General MIDI program — or, on a percussion track, a **kit**. */
  midiProgram: number;
  clef: 'treble' | 'bass' | 'percussion';
};

/**
 * Which General MIDI voice stands in for each stem.
 *
 * Approximations chosen for range as much as timbre, because the notes have to
 * be readable where they land: bass takes a bass clef and an acoustic bass,
 * vocals a treble clef and a voice patch. `other` is whatever was left after
 * the named stems, so it gets strings — the least wrong answer for a bed of
 * held chords, which is what that stem usually is.
 */
const STEM_INSTRUMENTS: Record<StemKind, StemInstrument> = {
  // 54 Voice Oohs, rather than a lead patch: a transcribed vocal is a melody
  // line without words, and a wordless voice is what that is.
  vocals: { name: 'Vocals', midiProgram: 54, clef: 'treble' },
  // Program 0 on a percussion track is the Standard kit — see `gm-kit.ts`. It
  // is not "Acoustic Grand Piano", because on a drum track the same field
  // names a kit.
  drums: { name: 'Drums', midiProgram: 0, clef: 'percussion' },
  bass: { name: 'Bass', midiProgram: 33, clef: 'bass' },
  guitar: { name: 'Guitar', midiProgram: 27, clef: 'treble' },
  piano: { name: 'Piano', midiProgram: 0, clef: 'treble' },
  other: { name: 'Other', midiProgram: 48, clef: 'treble' },
};

export function stemInstrument(kind: StemKind): StemInstrument {
  return STEM_INSTRUMENTS[kind];
}

/** Every stem a six-stem separation produces, in score order. */
export const STEM_ORDER: readonly StemKind[] = [
  'vocals',
  'guitar',
  'piano',
  'other',
  'bass',
  'drums',
];

/**
 * How long a transcribed drum stroke is written.
 *
 * A sixteenth. Drums have no duration worth notating — a kick is over long
 * before the next beat — but a note still needs a length, and a sixteenth reads
 * as a stroke rather than as something held.
 */
const DRUM_NOTE_FRACTION = 0.25;

/**
 * Drum strokes in seconds → notes in ticks.
 *
 * Against the same tempo the pitched stems were emitted at, so the parts line
 * up. Getting this backwards is silent — the drums would simply drift — which
 * is why it is one function with its own test rather than arithmetic repeated
 * per caller.
 */
export function drumHitsToNotes(
  hits: readonly DrumHit[],
  bpm: number,
  ppq: number,
): TranscribedNote[] {
  const ticksPerSecond = (bpm / 60) * ppq;
  const durationTicks = Math.max(1, Math.round(ppq * DRUM_NOTE_FRACTION));
  return hits.map((hit) => ({
    midi: hit.midi,
    startTick: Math.max(0, Math.round(hit.startSec * ticksPerSecond)),
    durationTicks,
  }));
}

/** One stem, already heard and converted to ticks. */
export type TranscribedStem = {
  kind: StemKind;
  notes: readonly TranscribedNote[];
};

/**
 * Orders stems for the score and drops the ones that came back empty.
 *
 * A separation always returns every stem it knows about, silence included — a
 * song with no guitar still yields a guitar stem, and writing an empty track
 * for it would leave the score full of parts nobody played.
 */
export function scoreStems(stems: readonly TranscribedStem[]): TranscribedStem[] {
  const byKind = new Map(stems.map((stem) => [stem.kind, stem]));
  return STEM_ORDER.map((kind) => byKind.get(kind)).filter(
    (stem): stem is TranscribedStem => stem !== undefined && stem.notes.length > 0,
  );
}

/** The last tick any stem reaches — how long the score has to be to hold them all. */
export function stemsEndTick(stems: readonly TranscribedStem[]): number {
  let end = 0;
  for (const stem of stems) {
    for (const note of stem.notes) end = Math.max(end, note.startTick + note.durationTicks);
  }
  return end;
}
