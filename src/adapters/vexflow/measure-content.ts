/**
 * Shared VexFlow measure-content builders (spec §7, §26): turn one domain
 * measure into its `Stave`/`Voice`s/`Beam`s, and a track's accumulated
 * note channels into `StaveTie`s. Consumed by `canvas-renderer.ts` per
 * drawn system; kept renderer-agnostic (nothing here draws or touches a
 * context/backend).
 *
 * Pure adapter: no store/React imports (spec §3, §37).
 */
import { Accidental, Beam, Stave, StaveTie, Voice } from 'vexflow';
import type { StaveNote } from 'vexflow';
import type { KeySignature, Measure, TimeSignature, Track } from '@sudobility/music_types';
import { buildVoiceContent, keySignatureToVexSpec, pitchToVexKey } from './convert.js';
import type { NoteMeta } from './convert.js';
import type { MeasureLayout } from './layout.js';

function sameTimeSignature(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function sameKeySignature(a: KeySignature, b: KeySignature): boolean {
  return a.fifths === b.fifths && a.mode === b.mode;
}

/** A single note/rest "channel" (spec §25 voice-ordinal convention, mirrored from `domain/score/ties.ts`) accumulated across a track's measures, for cross-measure/cross-decomposition tie detection. */
export type Channel = Array<{ note: StaveNote; meta: NoteMeta }>;

/** Builds one measure's `Stave`, its VexFlow `Voice`s, and its beams; records notes into `channels` for tie building. */
export function buildMeasureContent(
  measure: Measure,
  track: Track,
  placement: MeasureLayout,
  prevMeasure: Measure | undefined,
  ppq: number,
  channels: Map<number, Channel>,
  allMetas: NoteMeta[],
): { stave: Stave; voices: Voice[]; beams: Beam[] } {
  const { box, isFirstInSystem } = placement;
  const stave = new Stave(box.x, box.y, box.width);
  stave.setAttribute('id', measure.id);

  if (isFirstInSystem) {
    stave.addClef(track.clef);
  }
  if (isFirstInSystem || !prevMeasure || !sameKeySignature(prevMeasure.keySignature, measure.keySignature)) {
    stave.addKeySignature(keySignatureToVexSpec(measure.keySignature));
  }
  if (!prevMeasure || !sameTimeSignature(prevMeasure.timeSignature, measure.timeSignature)) {
    stave.addTimeSignature(`${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`);
  }

  const voices: Voice[] = [];
  const beams: Beam[] = [];

  measure.voices.forEach((domainVoice, voiceOrdinal) => {
    const { notes, metas } = buildVoiceContent(domainVoice.events, ppq);
    if (notes.length === 0) return;

    const vexVoice = new Voice({
      num_beats: measure.timeSignature.numerator,
      beat_value: measure.timeSignature.denominator,
    });
    // SOFT mode: don't throw if a voice's summed ticks don't exactly match
    // the time signature (e.g. the decomposeDuration nearest-duration
    // fallback for a non-standard remainder can be off by a few ticks).
    vexVoice.setMode(Voice.Mode.SOFT);
    vexVoice.addTickables(notes);
    voices.push(vexVoice);
    beams.push(...Beam.generateBeams(notes));

    const channel = channels.get(voiceOrdinal) ?? [];
    notes.forEach((note, i) => channel.push({ note, meta: metas[i] }));
    channels.set(voiceOrdinal, channel);
    allMetas.push(...metas);
  });

  // Accidental *glyphs* are decided here, once per measure, across every
  // voice on this stave — never unconditionally per note (see convert.ts):
  // VexFlow's own key-signature-and-context-aware logic decides whether a
  // sharp/flat/natural is actually needed (e.g. no redundant accidental on
  // an in-key F# in G major), reading each note's spelling straight out of
  // the `keys` string `convert.ts` already built.
  if (voices.length > 0) {
    Accidental.applyAccidentals(voices, keySignatureToVexSpec(measure.keySignature));
  }

  return { stave, voices, beams };
}

/**
 * Ties every adjacent pair of notes in a voice-ordinal channel whose keys
 * actually match by pitch — covers both cross-barline ties and same-measure
 * duration-decomposition ties with one mechanism. Matches by pitch, never
 * by array index/adjacency (a chord where only one of several members ties
 * forward must produce exactly one `StaveTie`, on the correct key indices
 * on each side — see `KeyTie`'s doc in convert.ts and
 * `domain/score/ties.ts`'s `findForwardPartner`/`findBackwardPartner`,
 * which requires the same tick/pitch/tie-flag matching for the same
 * reason: a same-tick note sharing a channel by coincidence must not be
 * spliced in).
 */
export function buildTies(channel: Channel): StaveTie[] {
  const ties: StaveTie[] = [];
  for (let i = 0; i < channel.length - 1; i += 1) {
    const a = channel[i];
    const b = channel[i + 1];
    if (a.meta.isRest || b.meta.isRest || !a.meta.tieStart || !b.meta.tieStop) continue;

    const firstIndices: number[] = [];
    const lastIndices: number[] = [];
    const usedB = new Set<number>();
    a.meta.keyTies.forEach((aKey, aIndex) => {
      if (!aKey.tieStart) return;
      const aSpelling = pitchToVexKey(aKey.pitch);
      const bIndex = b.meta.keyTies.findIndex(
        (bKey, idx) => !usedB.has(idx) && bKey.tieStop && pitchToVexKey(bKey.pitch) === aSpelling,
      );
      if (bIndex === -1) return;
      usedB.add(bIndex);
      firstIndices.push(aIndex);
      lastIndices.push(bIndex);
    });

    if (firstIndices.length === 0) continue;
    ties.push(new StaveTie({ first_note: a.note, last_note: b.note, first_indices: firstIndices, last_indices: lastIndices }));
  }
  return ties;
}
