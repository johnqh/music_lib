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
  Barline,
  Curve,
  Modifier,
  Repetition,
  StaveHairpin,
  StaveLine,
  TextBracket,
  StaveTie,
  Tuplet,
  Volta,
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
import { clefChangesAt, effectiveClef } from '@sudobility/music_types';
import {
  buildVoiceContent,
  keySignatureToVexSpec,
  pitchToVexKey,
} from './convert.js';
import { displayGroups, drumDisplayGroups } from './display-timing.js';
import { tupletGroups } from '@sudobility/music_types';
import { isFootDrum } from './percussion.js';
import { pitchToMidi } from '@sudobility/music_types';
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

/** Whether two bars belong to the same volta — the same numbers, in order. */
function sameEnding(a: Measure | undefined, b: Measure | undefined): boolean {
  const left = a?.endingNumbers;
  const right = b?.endingNumbers;
  if (!left || !right) return false;
  return left.length === right.length && left.every((n, i) => n === right[i]);
}

/**
 * Domain jump -> the `Repetition` VexFlow draws for it.
 *
 * A straight mapping: the two libraries name these the same way, unlike the
 * mordents, because the vocabulary is fixed Italian rather than a description.
 */
const JUMP_REPETITION: Record<NonNullable<Measure['jump']>, number> = {
  'da-capo': Repetition.type.DC,
  'da-capo-al-fine': Repetition.type.DC_AL_FINE,
  'da-capo-al-coda': Repetition.type.DC_AL_CODA,
  'dal-segno': Repetition.type.DS,
  'dal-segno-al-fine': Repetition.type.DS_AL_FINE,
  'dal-segno-al-coda': Repetition.type.DS_AL_CODA,
};

/** Builds one measure's `Stave`, its VexFlow `Voice`s, and its beams; records notes into `channels` for tie building. */
export function buildMeasureContent(
  measure: Measure,
  track: Track,
  /**
   * This measure's position in `track.measures`.
   *
   * Passed in rather than read off `measure.index`: a print-only part collapses
   * runs of rests, which shortens the array while every surviving measure keeps
   * its original `index`, so the two stop agreeing. The caller iterates the
   * array and knows the truth.
   */
  measureIndex: number,
  placement: MeasureLayout,
  prevMeasure: Measure | undefined,
  /** The bar after this one, for deriving where a volta bracket ends. */
  nextMeasure: Measure | undefined,
  ppq: number,
  channels: Map<number, Channel>,
  allMetas: NoteMeta[]
): {
  stave: Stave;
  voices: Voice[];
  beams: Beam[];
  /** Tuplet brackets and their numbers, drawn after the voices like beams. */
  tuplets: Tuplet[];
  multiMeasureRest?: MultiMeasureRest;
} {
  const { box, isFirstInSystem } = placement;
  // A percussion track's notes name drums, not pitches, which changes both
  // where they sit and whether an accidental could ever apply to them.
  // The clef *in force here*, which is not `track.clef` once a part changes
  // clef mid-piece — a piano left hand crossing into treble is the usual case.
  const clef = effectiveClef(track, measureIndex);
  const isPercussion = clef === 'percussion';
  const stave = new Stave(box.x, box.y, box.width);
  stave.setAttribute('id', measure.id);

  // At a system start the clef is re-stated because every system states it;
  // mid-system it is drawn only where it actually changes — exactly the rule
  // the key signature below already follows.
  if (isFirstInSystem || clefChangesAt(track, measureIndex)) {
    stave.addClef(clef);
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

  /*
    Repeat barlines. Stave-level, not note-level: they are the walls of the
    bar, so they belong here rather than anywhere in the note path.

    Set on both ends independently — a `:|` with no matching `|:` repeats from
    the start of the piece, which is a real marking rather than an error.
  */
  if (measure.repeatStart) stave.setBegBarType(Barline.type.REPEAT_BEGIN);
  if (measure.repeatEnd) stave.setEndBarType(Barline.type.REPEAT_END);

  /*
    A section break or the end of the piece.

    Applied *after* the repeat above and only when there is no repeat end here,
    so a bar that both closes a repeat and ends a section keeps the `:|` — the
    repeat is the instruction a player acts on, and a double bar drawn over it
    would silently remove a repeat from the performance.
  */
  if (measure.barline && !measure.repeatEnd) {
    stave.setEndBarType(
      measure.barline === 'final' ? Barline.type.END : Barline.type.DOUBLE
    );
  }

  /*
    The navigation marks: the sign, the coda, `Fine`, `To Coda` and the jump
    instruction itself.

    Drawn with VexFlow's `Repetition`, which places each above the stave at
    the side an engraver puts it — the segno and coda open a section so they
    sit on the left, while an instruction obeyed at the end of a bar sits on
    the right. Every one is independent: a bar can carry the coda sign and a
    `Fine`, and one can carry `To Coda` and nothing else.
  */
  if (measure.segno)
    stave.addModifier(new Repetition(Repetition.type.SEGNO_LEFT, 0, 0));
  if (measure.coda)
    stave.addModifier(new Repetition(Repetition.type.CODA_LEFT, 0, 0));
  if (measure.toCoda)
    stave.addModifier(new Repetition(Repetition.type.TO_CODA, 0, 0));
  if (measure.fine)
    stave.addModifier(new Repetition(Repetition.type.FINE, 0, 0));
  if (measure.jump)
    stave.addModifier(new Repetition(JUMP_REPETITION[measure.jump], 0, 0));

  /*
    The volta bracket, and which pass it covers.

    Derived from the neighbours rather than stored as a span: a bar opens the
    bracket when the bar before it is not part of the same ending, and closes
    it when the bar after is not. Deleting a bar out of a first ending then
    shortens the bracket instead of leaving one that points at nothing — the
    same reason a tuplet is derived from its durations.
  */
  if (measure.endingNumbers?.length) {
    const label = `${measure.endingNumbers.join(', ')}.`;
    const opens = !sameEnding(prevMeasure, measure);
    const closes = !sameEnding(nextMeasure, measure);
    const type = opens
      ? closes
        ? Volta.type.BEGIN_END
        : Volta.type.BEGIN
      : closes
        ? Volta.type.END
        : Volta.type.MID;
    // Only the opening bar prints the number; a continuation would repeat it
    // under its own bracket segment.
    stave.setVoltaType(type, opens ? label : '', 0);
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
      tuplets: [],
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
    if (notes.length === 0)
      return { stave, voices: [], beams: [], tuplets: [] };

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
      // A cue is a reminder of another player's line, printed small; it never
      // carries a bracket of its own.
      tuplets: [],
    };
  }

  const voices: Voice[] = [];
  const beams: Beam[] = [];
  const tuplets: Tuplet[] = [];

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

    /*
      Triplet brackets, derived from the durations rather than stored: three
      notes each two thirds of a plain value *are* a triplet, and `tupletGroups`
      reads exactly that. Built from `events` and applied to `notes` by index —
      the two are parallel only while nothing decomposes, so a group whose
      notes cannot be found is skipped rather than bracketing the wrong ones.
    */
    for (const group of tupletGroups(events, ppq)) {
      const members = notes.slice(group.start, group.start + group.length);
      if (members.length !== group.length) continue;
      const tuplet = new Tuplet(members, {
        num_notes: group.actualNotes,
        notes_occupied: group.normalNotes,
      });
      if (stemDirection !== undefined) tuplet.setTupletLocation(stemDirection);
      tuplets.push(tuplet);
    }

    const channel = channels.get(voiceOrdinal) ?? [];
    notes.forEach((note, i) => channel.push({ note, meta: metas[i] }));
    channels.set(voiceOrdinal, channel);
    allMetas.push(...metas);
  };

  /**
   * Whether this stave carries more than one voice with anything in it.
   *
   * A single voice keeps VexFlow's automatic stem direction, which is decided
   * per note from its position on the stave and is what an engraver would do.
   * Fixing it up on a one-voice stave would point half the notes the wrong way
   * for no benefit.
   */
  const soundingVoices = measure.voices.filter(v => v.events.length > 0).length;

  measure.voices.forEach((domainVoice, voiceOrdinal) => {
    if (!isPercussion) {
      // Two voices sharing a stave are told apart by their stems: the upper
      // voice up, the lower voice down. Without this they are drawn
      // identically and there is no way to see which line is being edited —
      // which is the whole reason a second voice exists.
      const stemDirection =
        soundingVoices > 1
          ? voiceOrdinal === 0
            ? Stem.UP
            : Stem.DOWN
          : undefined;
      addVoice(domainVoice.events, voiceOrdinal, stemDirection);
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

  return { stave, voices, beams, tuplets };
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

/**
 * Draws each phrase mark in a channel as one curve, start note to stop note.
 *
 * Unlike `buildTies` this does not work on adjacent pairs: a slur spans a run
 * of notes, and the pair to join is "the note that opened it" and "the next
 * one that closes it". Matching is by order rather than by pitch for the same
 * reason — a slur groups different pitches, which is what distinguishes it
 * from a tie.
 *
 * `isDrawn` filters the same hazard ties have: a curve is positioned from its
 * two notes' Y values, which only exist once they have been drawn, so one
 * reaching a culled off-screen stave would throw inside VexFlow.
 */
/**
 * Draws each hairpin in a channel as one wedge, opening note to closing note.
 *
 * `buildSlurs`' structure exactly, because a hairpin is the same kind of span:
 * opened by one note, closed by a later one, matched in order rather than by
 * pitch. It carries the same culling hazard too — a wedge is positioned from
 * its two notes' Y values, which only exist once they have been drawn, so one
 * reaching a culled off-screen stave throws inside VexFlow.
 *
 * Below the stave, where the dynamics already sit, so a level and the change
 * between two levels read as one system rather than two.
 */
export function buildHairpins(
  channel: Channel,
  isDrawn: (note: StaveNote) => boolean = () => true
): StaveHairpin[] {
  const hairpins: StaveHairpin[] = [];
  let open: {
    note: StaveNote;
    kind: NonNullable<NoteMeta['hairpinStart']>;
  } | null = null;

  for (const entry of channel) {
    if (entry.meta.isRest) continue;
    if (!open && entry.meta.hairpinStart) {
      open = { note: entry.note, kind: entry.meta.hairpinStart };
      continue;
    }
    if (open && entry.meta.hairpinStop) {
      if (isDrawn(open.note) && isDrawn(entry.note)) {
        const wedge = new StaveHairpin(
          { first_note: open.note, last_note: entry.note },
          open.kind === 'crescendo'
            ? StaveHairpin.type.CRESC
            : StaveHairpin.type.DECRESC
        );
        wedge.setPosition(Modifier.Position.BELOW);
        hairpins.push(wedge);
      }
      open = null;
    }
  }
  // An unclosed opening draws nothing: half a wedge is not a wedge, and the
  // command that writes these never produces one.
  return hairpins;
}

/**
 * The octave brackets in a channel, one `TextBracket` per span.
 *
 * Above the stave for `8va`/`15ma` and below for the `b` forms, which is where
 * the displacement points. Culled like the curves: a bracket is positioned
 * from its two notes, so one reaching an off-screen stave throws.
 */
export function buildOttavas(
  channel: Channel,
  isDrawn: (note: StaveNote) => boolean = () => true
): TextBracket[] {
  const brackets: TextBracket[] = [];
  let open: {
    note: StaveNote;
    kind: NonNullable<NoteMeta['ottavaStart']>;
  } | null = null;

  for (const entry of channel) {
    if (entry.meta.isRest) continue;
    if (!open && entry.meta.ottavaStart) {
      open = { note: entry.note, kind: entry.meta.ottavaStart };
      continue;
    }
    if (open && entry.meta.ottavaStop) {
      if (isDrawn(open.note) && isDrawn(entry.note)) {
        const above = open.kind === '8va' || open.kind === '15ma';
        brackets.push(
          new TextBracket({
            start: open.note,
            stop: entry.note,
            text: open.kind === '8va' || open.kind === '8vb' ? '8' : '15',
            superscript: open.kind.slice(1),
            position: above
              ? TextBracket.Position.TOP
              : TextBracket.Position.BOTTOM,
          })
        );
      }
      open = null;
    }
  }
  return brackets;
}

/**
 * The slides in a channel, drawn as a straight line between the two notes.
 *
 * VexFlow has no `Glissando`; a `StaveLine` between the notes is what its own
 * examples use, and it is what a glissando is on the page — a line from one
 * notehead to the next.
 */
export function buildGlissandos(
  channel: Channel,
  isDrawn: (note: StaveNote) => boolean = () => true
): StaveLine[] {
  const lines: StaveLine[] = [];
  let open: Channel[number] | null = null;

  for (const entry of channel) {
    if (entry.meta.isRest) continue;
    if (!open && entry.meta.glissandoStart) {
      open = entry;
      continue;
    }
    if (open && entry.meta.glissandoStop) {
      if (isDrawn(open.note) && isDrawn(entry.note)) {
        lines.push(
          new StaveLine({
            first_note: open.note,
            last_note: entry.note,
            first_indices: [0],
            last_indices: [0],
          })
        );
      }
      open = null;
    }
  }
  return lines;
}

export function buildSlurs(
  channel: Channel,
  isDrawn: (note: StaveNote) => boolean = () => true
): Curve[] {
  const slurs: Curve[] = [];
  let open: Channel[number] | null = null;

  for (const entry of channel) {
    if (entry.meta.isRest) continue;
    if (!open && entry.meta.slurStart) {
      open = entry;
      continue;
    }
    if (open && entry.meta.slurStop) {
      if (isDrawn(open.note) && isDrawn(entry.note)) {
        slurs.push(new Curve(open.note, entry.note, {}));
      }
      open = null;
    }
  }
  // An unclosed start draws nothing: half a phrase mark is not a phrase mark,
  // and the command that writes these never produces one.
  return slurs;
}
