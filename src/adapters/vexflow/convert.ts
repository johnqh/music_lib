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
import { Articulation, Dot, GhostNote, StaveNote } from 'vexflow';
import type { StemmableNote } from 'vexflow';
import type {
  Accidental as DomainAccidental,
  Articulation as DomainArticulation,
  DurationName,
  KeySignature,
  MusicalEvent,
  NoteEvent,
  Pitch,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { ticksFor } from '../../domain/time/ticks.js';
import { decomposeDuration } from '../../domain/time/durations.js';
import type { DisplayGroup } from './display-timing.js';
import { crossHeadStemOffsets, percussionVexKey } from './percussion.js';
import { pitchToMidi } from '../../domain/pitch/pitch.js';

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
const VEX_DURATION_CODES: Array<{ name: DurationName; code: string; dots: 0 | 1 }> = [
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

const MAJOR_KEYS_BY_FIFTHS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
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
  return ks.mode === 'minor' ? MINOR_KEYS_BY_FIFTHS[index] : MAJOR_KEYS_BY_FIFTHS[index];
}

const ARTICULATION_CODE: Record<DomainArticulation, string> = {
  staccato: 'a.',
  accent: 'a>',
  tenuto: 'a-',
  marcato: 'a^',
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
  isPercussion = false,
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
        : group.map((e) =>
            isPercussion
              ? percussionVexKey(pitchToMidi((e as NoteEvent).pitch))
              : pitchToVexKey((e as NoteEvent).pitch),
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
            staveNote.addModifier(new Articulation(ARTICULATION_CODE[noteEvent.articulation]), keyIndex);
          }
        });
      }

      // Segment vexIds must be unique per drawn StaveNote: reuse the group's
      // primary event id for the first segment (the common, non-decomposed
      // case) so `#vf-<eventId>` resolves directly; later segments (only
      // reached for the non-standard-duration fallback) get a suffix.
      const vexId = isFirstSegment ? first.id : `${first.id}::seg${segmentIndex}`;
      staveNote.setAttribute('id', vexId);

      // Every segment of a decomposed (non-standard-duration) note repeats
      // the same chord keys, so per-key ties there are unconditional
      // (`!isLastSegment` / `!isFirstSegment`) — only the *last* segment's
      // outgoing tie and the *first* segment's incoming tie depend on the
      // underlying domain event's own tieStart/tieStop.
      const keyTies: KeyTie[] = isRest
        ? []
        : group.map((event) => {
            const noteEvent = event as NoteEvent;
            return {
              pitch: noteEvent.pitch,
              tieStart: !isLastSegment || Boolean(noteEvent.tieStart),
              tieStop: !isFirstSegment || Boolean(noteEvent.tieStop),
            };
          });
      const tieStart = keyTies.some((k) => k.tieStart);
      const tieStop = keyTies.some((k) => k.tieStop);

      tickables.push(staveNote);
      notes.push(staveNote);
      metas.push({
        vexId,
        eventIds: group.map((e) => e.id),
        tieStart,
        tieStop,
        isRest,
        keyTies,
      });
    });
  }

  return { tickables, notes, metas };
}
