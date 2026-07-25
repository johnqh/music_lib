/**
 * Tick <-> MusicXML notated-duration (`<type>`/`<dot>`) conversion (spec §17).
 * Export needs to turn an arbitrary domain tick length into one or more
 * MusicXML note types (splitting into tied notes when a single length isn't
 * representable, per the Task 8 brief); import needs the inverse to size a
 * note purely from its `<type>`/`<dot>` when no `<duration>` is present
 * (e.g. a shorthand full-measure rest).
 */
import type { DurationName } from '@sudobility/music_types';
import { decomposeDuration } from '../../domain/time/durations';
import { ticksFor } from '../../domain/time/ticks';

/** MusicXML `<type>` element values this adapter supports (whole down to 32nd; no 64th+ or breve/long). */
export type MusicXmlNoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';

type BaseDurationName = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirtysecond';

const BASE_NAMES: BaseDurationName[] = ['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirtysecond'];

const BASE_NAME_TO_XML_TYPE: Record<BaseDurationName, MusicXmlNoteType> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  sixteenth: '16th',
  thirtysecond: '32nd',
};

const XML_TYPE_TO_BASE_NAME: Record<MusicXmlNoteType, BaseDurationName> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  '16th': 'sixteenth',
  '32nd': 'thirtysecond',
};

/** True for any string this adapter recognizes as a `MusicXmlNoteType`. */
export function isMusicXmlNoteType(value: string): value is MusicXmlNoteType {
  return Object.prototype.hasOwnProperty.call(XML_TYPE_TO_BASE_NAME, value);
}

export type NotatedDuration = { ticks: number; type: MusicXmlNoteType; dots: number };

/** Matches `ticks` exactly against a base or singly-dotted `DURATIONS` entry at `ppq`, or `null` if none fits. */
function classifyExact(ticks: number, ppq: number): NotatedDuration | null {
  for (const baseName of BASE_NAMES) {
    if (ticksFor(baseName, ppq) === ticks) {
      return { ticks, type: BASE_NAME_TO_XML_TYPE[baseName], dots: 0 };
    }
    const dottedName = `dotted-${baseName}` as DurationName;
    if (ticksFor(dottedName, ppq) === ticks) {
      return { ticks, type: BASE_NAME_TO_XML_TYPE[baseName], dots: 1 };
    }
  }
  return null;
}

/**
 * Splits `ticks` into one or more notated segments (type + dot count) that
 * together sum back to `ticks`, via `decomposeDuration`'s greedy largest-
 * fit-first algorithm (which itself only ever emits base/singly-dotted
 * `DURATIONS` lengths, or — as a last resort — a residual shorter than a
 * thirty-second note). More than one segment means the caller must emit
 * tied `<note>` elements for `ticks` to round-trip exactly.
 *
 * A residual too short to classify (shorter than a thirty-second note; only
 * possible for a tick length that isn't a multiple of the score's own
 * smallest grid unit) is notated as a thirty-second note whose `<duration>`
 * still carries its true, smaller tick length — MusicXML's `<duration>` is
 * authoritative for playback timing, so `<type>` is just a best-effort
 * visual approximation in this pathological case.
 */
export function notateDuration(ticks: number, ppq: number): NotatedDuration[] {
  const segments = decomposeDuration(ticks, ppq);
  return segments.map((segmentTicks) => classifyExact(segmentTicks, ppq) ?? { ticks: segmentTicks, type: '32nd' as const, dots: 0 });
}

/**
 * Ticks for a MusicXML `type` + dot count at `ppq`, via the general dotted-
 * duration formula `base * (2 - 2^-dots)` (dots=0 -> base; dots=1 -> 1.5x;
 * dots=2 -> 1.75x; ...), so import can size a note from `<type>`/`<dot>`
 * alone (e.g. a `<duration>`-less shorthand rest) even for a dot count
 * beyond the singly-dotted variants this adapter's own export emits.
 */
export function ticksForNotatedType(type: MusicXmlNoteType, dots: number, ppq: number): number {
  const baseTicks = ticksFor(XML_TYPE_TO_BASE_NAME[type], ppq);
  const multiplier = 2 - 2 ** -dots;
  return Math.round(baseTicks * multiplier);
}
