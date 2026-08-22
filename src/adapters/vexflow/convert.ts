/**
 * Domain -> VexFlow conversion helpers (spec §7, §26): pitch/duration/key
 * spelling, chord grouping, and building `StaveNote`s (with dots,
 * articulations, rest handling, and per-key tie metadata) for one voice's
 * worth of events. Accidental *glyphs* are deliberately NOT decided here —
 * see the comment above the `Articulation`/`Dot` modifier block in
 * `buildVoiceContent` — `renderer.ts` derives them per measure via
 * VexFlow's own `Accidental.applyAccidentals`, which is key-signature- and
 * context-aware.
 *
 * Pure-ish: builds VexFlow objects but never touches the DOM, a `Stave`'s
 * position, or a rendering context. No store/React imports (spec §3, §37).
 */
import {
  Annotation,
  AnnotationVerticalJustify,
  Articulation,
  Dot,
  GhostNote,
  GraceNote,
  GraceNoteGroup,
  FretHandFinger,
  Ornament,
  StaveNote,
  Stroke,
} from 'vexflow';
import type { StemmableNote } from 'vexflow';
import type {
  Accidental as DomainAccidental,
  Articulation as DomainArticulation,
  Hairpin as DomainHairpin,
  Ornament as DomainOrnament,
  Ottava as DomainOttava,
  DurationName,
  KeySignature,
  MusicalEvent,
  NoteEvent,
  Pitch,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { ticksFor } from '@sudobility/music_types';
import { decomposeDuration } from '@sudobility/music_types';
import type { DisplayGroup } from './display-timing.js';
import { crossHeadStemOffsets, percussionVexKey } from './percussion.js';
import { pitchToMidi } from '@sudobility/music_types';

/** `Pitch.accidental` (-2..2) -> VexFlow accidental suffix/code (`''` for natural, no glyph drawn). */
const ACCIDENTAL_SUFFIX: Record<DomainAccidental, string> = {
  [-2]: 'bb',
  [-1]: 'b',
  [0]: '',
  [1]: '#',
  [2]: '##',
};

/** `Pitch` -> VexFlow key string, e.g. `{step:'C',accidental:1,octave:4}` -> `"c#/4"`. */
export function pitchToVexKey(pitch: Pitch): string {
  return `${pitch.step.toLowerCase()}${ACCIDENTAL_SUFFIX[pitch.accidental]}/${pitch.octave}`;
}

/** Non-triplet `DurationName`s mapped to VexFlow's duration code, largest first (matches `decomposeDuration`'s candidate order). */
const VEX_DURATION_CODES: Array<{
  name: DurationName;
  code: string;
  dots: 0 | 1;
}> = [
  { name: 'whole', code: 'w', dots: 0 },
  { name: 'dotted-whole', code: 'w', dots: 1 },
  { name: 'half', code: 'h', dots: 0 },
  { name: 'dotted-half', code: 'h', dots: 1 },
  { name: 'quarter', code: 'q', dots: 0 },
  { name: 'dotted-quarter', code: 'q', dots: 1 },
  { name: 'eighth', code: '8', dots: 0 },
  { name: 'dotted-eighth', code: '8', dots: 1 },
  { name: 'sixteenth', code: '16', dots: 0 },
  { name: 'dotted-sixteenth', code: '16', dots: 1 },
  { name: 'thirtysecond', code: '32', dots: 0 },
  { name: 'dotted-thirtysecond', code: '32', dots: 1 },
];

export type VexDuration = { code: string; dots: 0 | 1 };

/**
 * Maps a tick length to a VexFlow duration code + dot count. `decomposeDuration`
 * (domain layer) already greedily breaks a span into the largest renderable
 * chunks, but its documented fallback is to emit a non-standard remainder
 * tick length verbatim when nothing fits exactly (e.g. a span shorter than a
 * thirty-second note, or one that doesn't land on any named duration at this
 * PPQ). For that fallback case we approximate to the *nearest* renderable
 * duration by tick distance so rendering never throws; the visual duration
 * won't be tick-exact in that rare case (documented limitation, spec §26
 * treats layout as heuristic).
 */
export function ticksToVexDuration(ticks: number, ppq: number): VexDuration {
  let best = VEX_DURATION_CODES[0];
  let bestDelta = Infinity;
  for (const candidate of VEX_DURATION_CODES) {
    const candidateTicks = ticksFor(candidate.name, ppq);
    const delta = Math.abs(candidateTicks - ticks);
    if (delta === 0) return { code: candidate.code, dots: candidate.dots };
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return { code: best.code, dots: best.dots };
}

const MAJOR_KEYS_BY_FIFTHS = [
  'Cb',
  'Gb',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
];
const MINOR_KEYS_BY_FIFTHS = [
  'Abm',
  'Ebm',
  'Bbm',
  'Fm',
  'Cm',
  'Gm',
  'Dm',
  'Am',
  'Em',
  'Bm',
  'F#m',
  'C#m',
  'G#m',
  'D#m',
  'A#m',
];

/** `KeySignature` -> VexFlow key spec string (e.g. `{fifths:-2,mode:'major'}` -> `"Bb"`). Clamped to [-7,7]. */
export function keySignatureToVexSpec(ks: KeySignature): string {
  const clamped = Math.max(-7, Math.min(7, ks.fifths));
  const index = clamped + 7;
  return ks.mode === 'minor'
    ? MINOR_KEYS_BY_FIFTHS[index]
    : MAJOR_KEYS_BY_FIFTHS[index];
}

const ARTICULATION_CODE: Record<DomainArticulation, string> = {
  staccato: 'a.',
  accent: 'a>',
  tenuto: 'a-',
  marcato: 'a^',
};

/**
 * The fermata glyph: upright, above the stave.
 *
 * Always above, which is what an engraver does in single-voice music — the
 * inverted form (`a@u`) belongs to the lower part of a two-voice texture, not
 * to any stem-down note. **Known simplification**: a lower voice therefore
 * gets its pause above the stave too, where it should hang below.
 *
 * Deliberately not chosen from the note's stem direction, which is the obvious
 * wrong answer: `StaveNote.getStemDirection()` reports `Stem.UP` for *every*
 * pitch at construction — the real direction is resolved later, during
 * formatting — so keying off it here silently inverts every fermata in the
 * score. Measured: c/4, g/3, e/5 and a/5 all report UP.
 */
const FERMATA_ABOVE = 'a@a';

/**
 * Domain ornament -> VexFlow `Ornament` code.
 *
 * **Two of these look transposed and are not.** VexFlow's `'mordent'` draws
 * the `ornamentShortTrill` glyph — the one *without* the vertical stroke,
 * which musicians call an inverted (upper) mordent — while its
 * `'mordent_inverted'` draws `ornamentMordent`, the stroked one that is
 * simply "a mordent". So the two words are used the other way round from the
 * way a player uses them, and mapping them by name draws both backwards.
 * Verified against the constructed glyph codes rather than the docs.
 *
 * `'tr'`, not `'trill'`: the latter is not a code VexFlow knows and throws
 * inside the constructor.
 */
const ORNAMENT_CODE: Record<DomainOrnament, string> = {
  trill: 'tr',
  mordent: 'mordent_inverted',
  'inverted-mordent': 'mordent',
  turn: 'turn',
};

/** Groups events by identical `(startTick, durationTicks)` — VexFlow chord candidates within a single voice. */
export function groupSimultaneous(events: MusicalEvent[]): MusicalEvent[][] {
  const groups: MusicalEvent[][] = [];
  let currentKey: string | null = null;
  for (const event of events) {
    const key = `${event.startTick}:${event.durationTicks}`;
    if (key !== currentKey) {
      groups.push([]);
      currentKey = key;
    }
    groups[groups.length - 1].push(event);
  }
  return groups;
}

/**
 * Per-key tie state, parallel to a chord `StaveNote`'s `keys`/`getKeys()`
 * array (index-for-index — both are built from the same `group` in
 * `buildVoiceContent`). Ties must be matched between two adjacent notes by
 * *pitch*, never by array index/adjacency alone: a chord where only one of
 * several members ties into the next chord must produce exactly one
 * `StaveTie`, on the matching key indices on each side — see
 * `domain/score/ties.ts`'s `findForwardPartner`/`findBackwardPartner`,
 * which documents the same requirement for the domain-level tie chain.
 */
export type KeyTie = { pitch: Pitch; tieStart: boolean; tieStop: boolean };

/** One produced `StaveNote` (possibly a chord, possibly one segment of a tie-decomposed event) and the metadata needed to build id maps and cross-note ties. */
export type NoteMeta = {
  /** The id set via `note.setAttribute('id', vexId)`; the drawn SVG group's id is `vf-${vexId}`. */
  vexId: string;
  /** Domain event ids this VexFlow note represents (>1 for a chord). */
  eventIds: string[];
  /** `true` if any key ties out of/into this note — a cheap pre-filter; the actual tie must still be resolved per-key via `keyTies` (see its doc). */
  tieStart: boolean;
  tieStop: boolean;
  isRest: boolean;
  /** Per-key tie state, parallel to the `StaveNote`'s keys. Empty for rests. */
  keyTies: KeyTie[];
  /**
   * Whether a phrase mark starts or ends here.
   *
   * Not per-key, unlike ties: a slur is one curve over a run of notes, so a
   * chord under one carries it as a whole rather than per notehead.
   */
  slurStart: boolean;
  slurStop: boolean;
  /**
   * The ends of a hairpin, carried for the same reason and with the same rule
   * as the slur above: one wedge over a run of notes, so a chord under one
   * carries it whole rather than per notehead.
   *
   * The start keeps its direction rather than being a boolean, because that is
   * what decides which way the wedge opens.
   */
  hairpinStart: DomainHairpin | null;
  hairpinStop: boolean;
  /** The ends of an octave bracket, carried like the hairpin's. */
  ottavaStart: DomainOttava | null;
  ottavaStop: boolean;
  /** The ends of a slide. */
  glissandoStart: boolean;
  glissandoStop: boolean;
};

export type VoiceContent = {
  /**
   * Everything the VexFlow voice holds, spacers included — this is what goes
   * into `Voice.addTickables` and into beaming, and what the formatter counts.
   */
  tickables: StemmableNote[];
  /** The drawn notes only, parallel to `metas`; spacers are not notes. */
  notes: StaveNote[];
  metas: NoteMeta[];
};

const REST_KEY = 'b/4';

/**
 * Builds VexFlow `StaveNote`s for one voice's worth of display groups, as
 * decided by `displayGroups` — which is where a measure's timing is resolved
 * into durations that can actually be drawn. Each group becomes one
 * `StaveNote`, with several events in a group drawn as a chord.
 *
 * A group whose duration isn't representable as a single VexFlow duration is
 * decomposed (`decomposeDuration`) into consecutive `StaveNote`s tied
 * together, mirroring the domain's own `splitNoteAcrossMeasures` convention
 * (first/middle/last tie flags).
 *
 * Returns `notes`/`metas` as parallel arrays (same length, same order).
 */
export function buildVoiceContent(
  groups: DisplayGroup[],
  ppq: number,
  glyphScale?: number,
  /**
   * Draw the events as drums rather than pitches: fixed staff positions and
   * cross noteheads, per `percussion.ts`. A drum's "pitch" says which drum was
   * struck, so drawn literally a kick lands six ledger lines below the staff.
   */
  isPercussion = false
): VoiceContent {
  const tickables: StemmableNote[] = [];
  const notes: StaveNote[] = [];
  const metas: NoteMeta[] = [];

  for (const { events: group, durationTicks } of groups) {
    // A spacer: time the voice must account for so it still sums to the bar,
    // drawing nothing. Two voices on one drum staff need these wherever the
    // other voice is the one playing.
    if (group.length === 0) {
      for (const segmentTicks of decomposeDuration(durationTicks, ppq)) {
        const { code, dots } = ticksToVexDuration(segmentTicks, ppq);
        tickables.push(new GhostNote({ duration: code, dots }));
      }
      continue;
    }

    const first = group[0];
    const isRest = !isNoteEvent(first);
    // The group's display duration, not the event's recorded one: a recorded
    // duration is rarely a note value, and rounding each one independently is
    // what put voices of the same bar on different timelines. See
    // `display-timing.ts`.
    const segments = decomposeDuration(durationTicks, ppq);

    segments.forEach((segmentTicks, segmentIndex) => {
      const isFirstSegment = segmentIndex === 0;
      const isLastSegment = segmentIndex === segments.length - 1;
      const { code, dots } = ticksToVexDuration(segmentTicks, ppq);

      const keys = isRest
        ? [REST_KEY]
        : group.map(e =>
            isPercussion
              ? percussionVexKey(pitchToMidi((e as NoteEvent).pitch))
              : pitchToVexKey((e as NoteEvent).pitch)
          );

      const staveNote = new StaveNote({
        keys,
        duration: code,
        dots,
        type: isRest ? 'r' : undefined,
        // Omitted rather than passed as undefined: VexFlow reads the key's
        // presence, not its value.
        ...(glyphScale === undefined ? {} : { glyph_font_scale: glyphScale }),
      });

      // A cross notehead is hollow where a stem meets it, so the stem has to
      // reach further in to join up. See `crossHeadStemOffsets`.
      const stemOffsets = crossHeadStemOffsets(keys);
      if (stemOffsets) staveNote.getStem()?.setOptions(stemOffsets);

      for (let i = 0; i < dots; i += 1) {
        Dot.buildAndAttach([staveNote], { all: true });
      }

      // Accidental glyphs are NOT added here: `keys` already embeds each
      // note's absolute spelling (e.g. "f#/4"), and `renderer.ts` calls
      // VexFlow's `Accidental.applyAccidentals(voices, keySpec)` once per
      // measure, which decides — in light of the measure's key signature
      // and any earlier accidental on the same pitch/octave in the measure
      // — whether a sharp/flat/natural glyph is actually needed. Adding a
      // modifier unconditionally here would draw a redundant accidental on
      // every in-key altered note (e.g. every F# in G major).
      if (!isRest) {
        group.forEach((event, keyIndex) => {
          const noteEvent = event as NoteEvent;
          if (noteEvent.articulation) {
            staveNote.addModifier(
              new Articulation(ARTICULATION_CODE[noteEvent.articulation]),
              keyIndex
            );
          }
          /*
            The pause, above the stave — see `FERMATA_ABOVE`.

            Added after the articulation deliberately: VexFlow stacks
            modifiers outward in the order they arrive, so a staccato dot sits
            against the notehead and the fermata arches over it, rather than
            the dot floating outside the arc.
          */
          if (noteEvent.fermata) {
            staveNote.addModifier(new Articulation(FERMATA_ABOVE), keyIndex);
          }
          /*
            The ornament sign. A modifier like the others, and only ever one —
            the model holds a single sign, because a trill that is also a turn
            is not a marking anybody writes.
          */
          if (noteEvent.ornament) {
            staveNote.addModifier(
              new Ornament(ORNAMENT_CODE[noteEvent.ornament]),
              keyIndex
            );
          }
          /*
            A rolled chord. Added once, on the first key, because the stroke is
            drawn beside the whole chord rather than beside a notehead — adding
            it per member would stack one wavy line per note.

            Meaningless on a single note and skipped there: there is only one
            notehead to roll through.
          */
          if (noteEvent.arpeggiate && keyIndex === 0 && group.length > 1) {
            staveNote.addStroke(0, new Stroke(Stroke.Type.ROLL_UP));
          }
          /*
            The finger to play with, beside its own notehead — per key, unlike
            the marks above, because in a chord each note has its own finger.
          */
          if (noteEvent.fingering) {
            staveNote.addModifier(
              new FretHandFinger(noteEvent.fingering),
              keyIndex
            );
          }
          /*
            The dynamic marking, under the stave where it is read.
            `Annotation` rather than VexFlow's `TextDynamics`, which is a
            tickable and would need a voice of its own aligned to this one —
            a whole parallel layout for a piece of text that belongs to a
            note. Only on the first key of a chord: a dynamic marks the
            moment, not each notehead in it.
          */
          /*
            The chord symbol, above the stave where a player reads it — the
            opposite side from the lyric and the dynamic, which is what keeps
            the three legible at once on a lead sheet.
          */
          if (noteEvent.chordSymbol && keyIndex === 0) {
            const symbol = new Annotation(noteEvent.chordSymbol);
            symbol.setVerticalJustification(AnnotationVerticalJustify.TOP);
            symbol.setFont('serif', 12, 'bold');
            staveNote.addModifier(symbol, keyIndex);
          }

          /*
            Ornaments, drawn small and ahead of the note they decorate.

            A `GraceNoteGroup` is a modifier on the principal, which is the
            same relationship the model stores — the notes are not tickables in
            the voice and take none of the bar's time, so nothing that sums a
            measure has to know they exist.

            First key only: an ornament leads into the moment, not into each
            notehead of a chord.
          */
          if (noteEvent.graceNotes?.length && keyIndex === 0) {
            const graceNotes = noteEvent.graceNotes.map(grace => {
              const { code, dots } = ticksToVexDuration(
                grace.durationTicks,
                ppq
              );
              return new GraceNote({
                keys: [pitchToVexKey(grace.pitch)],
                duration: code,
                dots,
                slash: grace.slashed ?? false,
              });
            });
            const group = new GraceNoteGroup(graceNotes, true);
            // Beamed when there is more than one, the way a run of ornaments
            // is engraved.
            if (graceNotes.length > 1) group.beamNotes();
            staveNote.addModifier(group, keyIndex);
          }

          /*
            The sung syllable, under the stave.

            Added before the dynamic so VexFlow's modifier context stacks it
            nearest the notes, which is where a singer reads it — a dynamic
            belongs below the words, not between them and the staff. A
            hyphenated syllable prints its own trailing hyphen, because the
            model records that the word continues and nothing else in the draw
            path knows it.
          */
          if (noteEvent.lyric && keyIndex === 0) {
            const continues =
              noteEvent.lyric.syllabic === 'begin' ||
              noteEvent.lyric.syllabic === 'middle';
            const text = new Annotation(
              continues ? `${noteEvent.lyric.text}-` : noteEvent.lyric.text
            );
            text.setVerticalJustification(AnnotationVerticalJustify.BOTTOM);
            text.setFont('serif', 11, 'normal');
            staveNote.addModifier(text, keyIndex);
          }

          if (noteEvent.dynamic && keyIndex === 0) {
            const mark = new Annotation(noteEvent.dynamic);
            mark.setVerticalJustification(AnnotationVerticalJustify.BOTTOM);
            // Bold italic serif is how a dynamic is engraved, and is what
            // distinguishes it from a lyric or a chord symbol at a glance.
            mark.setFont('serif', 12, 'bold', 'italic');
            staveNote.addModifier(mark, keyIndex);
          }
        });
      }

      // Segment vexIds must be unique per drawn StaveNote: reuse the group's
      // primary event id for the first segment (the common, non-decomposed
      // case) so `#vf-<eventId>` resolves directly; later segments (only
      // reached for the non-standard-duration fallback) get a suffix.
      const vexId = isFirstSegment
        ? first.id
        : `${first.id}::seg${segmentIndex}`;
      staveNote.setAttribute('id', vexId);

      // Every segment of a decomposed (non-standard-duration) note repeats
      // the same chord keys, so per-key ties there are unconditional
      // (`!isLastSegment` / `!isFirstSegment`) — only the *last* segment's
      // outgoing tie and the *first* segment's incoming tie depend on the
      // underlying domain event's own tieStart/tieStop.
      const keyTies: KeyTie[] = isRest
        ? []
        : group.map(event => {
            const noteEvent = event as NoteEvent;
            return {
              pitch: noteEvent.pitch,
              tieStart: !isLastSegment || Boolean(noteEvent.tieStart),
              tieStop: !isFirstSegment || Boolean(noteEvent.tieStop),
            };
          });
      const tieStart = keyTies.some(k => k.tieStart);
      const tieStop = keyTies.some(k => k.tieStop);

      tickables.push(staveNote);
      notes.push(staveNote);
      metas.push({
        vexId,
        eventIds: group.map(e => e.id),
        tieStart,
        tieStop,
        isRest,
        keyTies,
        // Only the segment a decomposed note actually begins or ends on can
        // carry the mark, or a note split across a barline would sprout a
        // curve at every join.
        slurStart:
          isFirstSegment &&
          group.some(
            e => isNoteEvent(e) && Boolean((e as NoteEvent).slurStart)
          ),
        slurStop:
          isLastSegment &&
          group.some(e => isNoteEvent(e) && Boolean((e as NoteEvent).slurStop)),
        // Same first/last-segment rule: a note decomposed across a barline
        // must open its wedge once, not at every tied join.
        hairpinStart: isFirstSegment
          ? ((
              group.find(
                e => isNoteEvent(e) && (e as NoteEvent).hairpinStart
              ) as NoteEvent | undefined
            )?.hairpinStart ?? null)
          : null,
        hairpinStop:
          isLastSegment &&
          group.some(
            e => isNoteEvent(e) && Boolean((e as NoteEvent).hairpinStop)
          ),
        ottavaStart: isFirstSegment
          ? ((
              group.find(
                e => isNoteEvent(e) && (e as NoteEvent).ottavaStart
              ) as NoteEvent | undefined
            )?.ottavaStart ?? null)
          : null,
        ottavaStop:
          isLastSegment &&
          group.some(
            e => isNoteEvent(e) && Boolean((e as NoteEvent).ottavaStop)
          ),
        glissandoStart:
          isFirstSegment &&
          group.some(
            e => isNoteEvent(e) && Boolean((e as NoteEvent).glissandoStart)
          ),
        glissandoStop:
          isLastSegment &&
          group.some(
            e => isNoteEvent(e) && Boolean((e as NoteEvent).glissandoStop)
          ),
      });
    });
  }

  return { tickables, notes, metas };
}
