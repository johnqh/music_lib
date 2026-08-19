/**
 * Shared VexFlow measure-content builders (spec §7, §26): turn one domain
 * measure into its `Stave`/`Voice`s/`Beam`s, and a track's accumulated
 * note channels into `StaveTie`s. Consumed by `canvas-renderer.ts` per
 * drawn system; kept renderer-agnostic (nothing here draws or touches a
 * context/backend).
 *
 * Pure adapter: no store/React imports (spec §3, §37).
 */
import {
  Accidental,
  Beam,
  MultiMeasureRest,
  Stave,
  StaveModifierPosition,
  StaveTie,
  Stem,
  TextJustification,
  Voice,
} from 'vexflow';
import type { StaveNote, StemmableNote } from 'vexflow';
import { isNoteEvent } from '@sudobility/music_types';
import type {
  KeySignature,
  Measure,
  MusicalEvent,
  TimeSignature,
  Track,
} from '@sudobility/music_types';
import {
  buildVoiceContent,
  keySignatureToVexSpec,
  pitchToVexKey,
} from './convert.js';
import { displayGroups, drumDisplayGroups } from './display-timing.js';
import { isFootDrum } from './percussion.js';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import type { NoteMeta } from './convert.js';
import type { MeasureLayout } from './layout.js';

/**
 * Glyph scale for cue notes. VexFlow's default is 38; grace notes use a
 * comparable reduction. Small enough to read as "not yours" at a glance,
 * large enough to read at all.
 */
export const CUE_GLYPH_SCALE = 26;

/** Cue labels are small italic by convention, and must not crowd the bar number. */
export const CUE_LABEL_FONT_SIZE = 9;

function sameTimeSignature(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function sameKeySignature(a: KeySignature, b: KeySignature): boolean {
  return a.fifths === b.fifths && a.mode === b.mode;
}

/** A single note/rest "channel" (spec §25 voice-ordinal convention, mirrored from `domain/score/ties.ts`) accumulated across a track's measures, for cross-measure/cross-decomposition tie detection. */
export type Channel = Array<{ note: StaveNote; meta: NoteMeta }>;

/**
 * Beams one voice's tickables — flat, and in the voice's own direction, when
 * that voice is a drum voice.
 *
 * Beamed by pitch, as melodic notes are, a drum beam followed the gap between
 * a kick and a hi-hat: it swept diagonally from above the staff down past the
 * bottom of it. Drum notation answers that with flat beams, which is what the
 * convention exists for. Spacers are passed through rather than filtered out,
 * so a beam correctly stops where the voice stops playing.
 */
function beamsFor(tickables: StemmableNote[], stemDirection?: number): Beam[] {
  if (stemDirection === undefined) return Beam.generateBeams(tickables);
  return Beam.generateBeams(tickables, {
    flat_beams: true,
    stem_direction: stemDirection,
  });
}

/**
 * Splits a drum voice into what the player's hands do and what their feet do.
 *
 * Feet are the bass drum and the hi-hat pedal; everything else is hands. The
 * split exists so the two can be stemmed in opposite directions — the reason
 * drum charts are readable at a glance.
 */
function splitHandsAndFeet(events: MusicalEvent[]): {
  hands: MusicalEvent[];
  feet: MusicalEvent[];
} {
  const hands: MusicalEvent[] = [];
  const feet: MusicalEvent[] = [];
  for (const event of events) {
    // Rests belong to the hands: a bar of silence should show one rest, not two.
    if (isNoteEvent(event) && isFootDrum(pitchToMidi(event.pitch)))
      feet.push(event);
    else hands.push(event);
  }
  return { hands, feet };
}

/** Builds one measure's `Stave`, its VexFlow `Voice`s, and its beams; records notes into `channels` for tie building. */
export function buildMeasureContent(
  measure: Measure,
  track: Track,
  placement: MeasureLayout,
  prevMeasure: Measure | undefined,
  ppq: number,
  channels: Map<number, Channel>,
  allMetas: NoteMeta[]
): {
  stave: Stave;
  voices: Voice[];
  beams: Beam[];
  multiMeasureRest?: MultiMeasureRest;
} {
  const { box, isFirstInSystem } = placement;
  // A percussion track's notes name drums, not pitches, which changes both
  // where they sit and whether an accidental could ever apply to them.
  const isPercussion = track.clef === 'percussion';
  const stave = new Stave(box.x, box.y, box.width);
  stave.setAttribute('id', measure.id);

  if (isFirstInSystem) {
    stave.addClef(track.clef);
  }
  // A drum staff has no key: its lines are instruments, not pitches, so a
  // signature there is meaningless — and the sharps were being drawn against
  // notes no accidental can apply to.
  if (
    !isPercussion &&
    (isFirstInSystem ||
      !prevMeasure ||
      !sameKeySignature(prevMeasure.keySignature, measure.keySignature))
  ) {
    stave.addKeySignature(keySignatureToVexSpec(measure.keySignature));
  }
  if (
    !prevMeasure ||
    !sameTimeSignature(prevMeasure.timeSignature, measure.timeSignature)
  ) {
    stave.addTimeSignature(
      `${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`
    );
  }

  // Boxed, because a bare letter beside a dynamic or a tempo marking is easy
  // to miss — and a rehearsal mark that is missed has failed at its one job.
  // Set before the multi-measure-rest return, so a marked rest still shows its
  // letter: that bar is exactly the one a lost player is hunting for.
  if (measure.rehearsalMark !== undefined) {
    stave.setSection(measure.rehearsalMark, 0, 0, 12, true);
  }

  // A collapsed measure draws one wide rest and a numeral instead of notes.
  // Returned rather than drawn here so the renderer keeps sole responsibility
  // for putting ink on a context.
  if (measure.multiMeasureRestCount !== undefined) {
    return {
      stave,
      voices: [],
      beams: [],
      // The count goes in twice: VexFlow takes it positionally and also
      // requires it in the options, which `Factory.MultiMeasureRest` fills in
      // for you. Constructing directly means supplying both.
      multiMeasureRest: new MultiMeasureRest(measure.multiMeasureRestCount, {
        number_of_measures: measure.multiMeasureRestCount,
        show_number: true,
      }),
    };
  }

  // A cue bar draws the cue and nothing else. The player's own whole-bar rest
  // would collide with it — the canvas layout has no collision avoidance — and
  // small notes under an instrument name already read as "not yours".
  //
  // Deliberately not recorded into `channels` or `allMetas`: a cue note is not
  // the player's note, so it must never tie to one or answer a hit test.
  if (measure.cue !== undefined) {
    stave.setText(measure.cue.label, StaveModifierPosition.ABOVE, {
      justification: TextJustification.LEFT,
    });

    // Small italic, the engraving convention for a cue label — and small
    // enough not to crowd the measure number sitting just above it.
    // `setText` returns the stave, not the modifier, so the StaveText has to
    // be fetched back off the stave to restyle it.
    const staveTexts = stave
      .getModifiers()
      .filter(m => m.getCategory() === 'StaveText');
    staveTexts[staveTexts.length - 1]?.setFont({
      family: 'serif',
      size: CUE_LABEL_FONT_SIZE,
      weight: 'normal',
      style: 'italic',
    });

    const { tickables, notes } = buildVoiceContent(
      displayGroups(
        measure.cue.events,
        measure.startTick,
        measure.durationTicks,
        ppq
      ),
      ppq,
      CUE_GLYPH_SCALE,
      isPercussion
    );
    if (notes.length === 0) return { stave, voices: [], beams: [] };

    const cueVoice = new Voice({
      num_beats: measure.timeSignature.numerator,
      beat_value: measure.timeSignature.denominator,
    });
    cueVoice.setMode(Voice.Mode.SOFT);
    cueVoice.addTickables(tickables);
    if (!isPercussion)
      Accidental.applyAccidentals(
        [cueVoice],
        keySignatureToVexSpec(measure.keySignature)
      );

    return {
      stave,
      voices: [cueVoice],
      beams: beamsFor(tickables, isPercussion ? Stem.UP : undefined),
    };
  }

  const voices: Voice[] = [];
  const beams: Beam[] = [];

  /** Builds one VexFlow voice, recording its notes under `voiceOrdinal` for ties. */
  const addVoice = (
    events: MusicalEvent[],
    voiceOrdinal: number,
    stemDirection?: number
  ): void => {
    const { tickables, notes, metas } = buildVoiceContent(
      isPercussion
        ? drumDisplayGroups(
            events,
            measure.startTick,
            measure.durationTicks,
            ppq
          )
        : displayGroups(events, measure.startTick, measure.durationTicks, ppq),
      ppq,
      undefined,
      isPercussion
    );
    if (notes.length === 0) return;
    if (stemDirection !== undefined)
      for (const note of notes) note.setStemDirection(stemDirection);

    const vexVoice = new Voice({
      num_beats: measure.timeSignature.numerator,
      beat_value: measure.timeSignature.denominator,
    });
    // SOFT mode: don't throw if a voice's summed ticks don't exactly match
    // the time signature (e.g. the decomposeDuration nearest-duration
    // fallback for a non-standard remainder can be off by a few ticks).
    vexVoice.setMode(Voice.Mode.SOFT);
    vexVoice.addTickables(tickables);
    voices.push(vexVoice);
    beams.push(...beamsFor(tickables, stemDirection));

    const channel = channels.get(voiceOrdinal) ?? [];
    notes.forEach((note, i) => channel.push({ note, meta: metas[i] }));
    channels.set(voiceOrdinal, channel);
    allMetas.push(...metas);
  };

  measure.voices.forEach((domainVoice, voiceOrdinal) => {
    if (!isPercussion) {
      addVoice(domainVoice.events, voiceOrdinal);
      return;
    }
    // A drum staff carries two voices, not one: hands stemmed up, feet stemmed
    // down. Struck together in a single voice they became one chord, so a kick
    // in the bottom space and a hi-hat above the top line shared one stem
    // running the height of the staff. Splitting them is what every drum chart
    // does, and it is the only way the two can point in opposite directions.
    const { hands, feet } = splitHandsAndFeet(domainVoice.events);
    addVoice(hands, voiceOrdinal, Stem.UP);
    addVoice(feet, voiceOrdinal, Stem.DOWN);
  });

  // Accidental *glyphs* are decided here, once per measure, across every
  // voice on this stave — never unconditionally per note (see convert.ts):
  // VexFlow's own key-signature-and-context-aware logic decides whether a
  // sharp/flat/natural is actually needed (e.g. no redundant accidental on
  // an in-key F# in G major), reading each note's spelling straight out of
  // the `keys` string `convert.ts` already built.
  if (voices.length > 0) {
    if (!isPercussion)
      Accidental.applyAccidentals(
        voices,
        keySignatureToVexSpec(measure.keySignature)
      );
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
export function buildTies(
  channel: Channel,
  /**
   * Whether a note was actually drawn this frame.
   *
   * A tie is positioned from its two notes' Y values, which only exist once
   * the note has been drawn — so a tie to a note on a culled (off-screen)
   * stave throws `NoYValues` inside VexFlow. Filtering here rather than
   * catching there is what keeps one such pair from taking the rest of the
   * channel's ties with it.
   */
  isDrawn: (note: StaveNote) => boolean = () => true
): StaveTie[] {
  const ties: StaveTie[] = [];
  for (let i = 0; i < channel.length - 1; i += 1) {
    const a = channel[i];
    const b = channel[i + 1];
    if (a.meta.isRest || b.meta.isRest || !a.meta.tieStart || !b.meta.tieStop)
      continue;
    if (!isDrawn(a.note) || !isDrawn(b.note)) continue;

    const firstIndices: number[] = [];
    const lastIndices: number[] = [];
    const usedB = new Set<number>();
    a.meta.keyTies.forEach((aKey, aIndex) => {
      if (!aKey.tieStart) return;
      const aSpelling = pitchToVexKey(aKey.pitch);
      const bIndex = b.meta.keyTies.findIndex(
        (bKey, idx) =>
          !usedB.has(idx) &&
          bKey.tieStop &&
          pitchToVexKey(bKey.pitch) === aSpelling
      );
      if (bIndex === -1) return;
      usedB.add(bIndex);
      firstIndices.push(aIndex);
      lastIndices.push(bIndex);
    });

    if (firstIndices.length === 0) continue;
    ties.push(
      new StaveTie({
        first_note: a.note,
        last_note: b.note,
        first_indices: firstIndices,
        last_indices: lastIndices,
      })
    );
  }
  return ties;
}
