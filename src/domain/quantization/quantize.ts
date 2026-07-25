/**
 * Reusable quantization engine (spec §24). `quantizeEvents` is a pure
 * function: it never mutates `events` or any event within it, and its
 * output depends only on its inputs (no randomness — "humanization" here
 * means a deterministic "already close enough, leave it" tolerance, not
 * random jitter). Exposed for both MIDI import cleanup and manual editing.
 */
import { createId } from '../score/ids.js';
import type { MusicalEvent } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import type { QuantizeOptions } from './options.js';

/** `tripletGrid` subdivides `grid` into thirds-of-two (2/3 of `grid`); otherwise the grid unit is used as-is. */
function effectiveGridTicks(opts: QuantizeOptions): number {
  return opts.tripletGrid ? (opts.grid * 2) / 3 : opts.grid;
}

/**
 * Snaps `original` to the nearest grid line (round-half-up, i.e. a note
 * exactly at the midpoint between two grid lines snaps to the later one),
 * then, if `swing` is set, delays every second grid slot (odd slot index)
 * by `swing` * one grid unit. If `humanizeToleranceTicks` is set and
 * `original` is already within that many ticks of the computed target, the
 * event is left at `original` instead (not force-snapped).
 */
function computeSnappedStart(original: number, opts: QuantizeOptions): number {
  const grid = effectiveGridTicks(opts);
  if (grid <= 0) return original;

  const slotIndex = Math.round(original / grid);
  let target = slotIndex * grid;
  if (opts.swing && slotIndex % 2 !== 0) {
    target += opts.swing * grid;
  }
  target = Math.round(target);

  if (
    opts.humanizeToleranceTicks !== undefined &&
    Math.abs(original - target) <= opts.humanizeToleranceTicks
  ) {
    return original;
  }
  return target;
}

/**
 * Snaps `original` to the nearest multiple of the grid unit, then clamps
 * the result up to at least `minDurationTicks` (default a hard 1-tick
 * floor when unset) so quantization can never produce a zero/negative
 * duration, which every other event in the domain model forbids.
 */
function computeSnappedDuration(original: number, opts: QuantizeOptions): number {
  const grid = effectiveGridTicks(opts);
  if (grid <= 0) return Math.max(original, opts.minDurationTicks ?? 1);

  const units = Math.round(original / grid);
  const snapped = Math.round(units * grid);
  return Math.max(snapped, opts.minDurationTicks ?? 1);
}

/** Drops `NoteEvent`s whose *original* duration is shorter than `minDurationTicks`. `RestEvent`s are never dropped. */
function dropShortNotes(
  events: MusicalEvent[],
  minDurationTicks: number | undefined,
): MusicalEvent[] {
  if (minDurationTicks === undefined) return events;
  return events.filter((event) => !isNoteEvent(event) || event.durationTicks >= minDurationTicks);
}

/** Groups events by (trackId, voiceId), preserving each group's first-seen order. */
function groupByVoice(events: MusicalEvent[]): MusicalEvent[][] {
  const order: string[] = [];
  const groups = new Map<string, MusicalEvent[]>();

  for (const event of events) {
    const key = `${event.trackId}::${event.voiceId}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      order.push(key);
    }
    group.push(event);
  }

  return order.map((key) => groups.get(key) as MusicalEvent[]);
}

/**
 * Clusters near-simultaneous onsets (already sorted by `startTick`) onto a
 * shared start tick: the first event in a run seeds a cluster "anchor";
 * every subsequent event within `tolerance` ticks of the anchor is
 * reassigned to the anchor's tick, otherwise it becomes the next cluster's
 * anchor. Anchoring (rather than comparing each event to its immediate
 * neighbor) bounds how far a chain of close onsets can drift in total.
 */
function applyChordGrouping(sorted: MusicalEvent[], tolerance: number): MusicalEvent[] {
  let anchor = 0;
  return sorted.map((event, index) => {
    if (index === 0) {
      anchor = event.startTick;
      return event;
    }
    if (event.startTick - anchor <= tolerance) {
      return { ...event, startTick: anchor };
    }
    anchor = event.startTick;
    return event;
  });
}

/**
 * Trims an event that overlaps the following event's start (already
 * sorted by `startTick`) down to end exactly at that start. Events sharing
 * an exact start tick are a chord, not an overlap, and are left alone.
 * Only adjacent pairs are compared, matching the everyday "this note runs
 * into the next one" meaning of overlap resolution.
 */
function applyResolveOverlaps(sorted: MusicalEvent[]): MusicalEvent[] {
  const result = sorted.map((event) => ({ ...event }));
  for (let i = 0; i < result.length - 1; i += 1) {
    const current = result[i];
    const next = result[i + 1];
    if (current.startTick === next.startTick) continue;

    const currentEnd = current.startTick + current.durationTicks;
    if (currentEnd > next.startTick) {
      current.durationTicks = Math.max(1, next.startTick - current.startTick);
    }
  }
  return result;
}

/**
 * Extends an event that falls short of the following event's start
 * (already sorted by `startTick`) so it ends exactly there, closing small
 * silent gaps. Never shrinks an event that already reaches or overlaps the
 * next one. Events sharing an exact start tick (a chord) are left alone.
 */
function applyLegatoCleanup(sorted: MusicalEvent[]): MusicalEvent[] {
  const result = sorted.map((event) => ({ ...event }));
  for (let i = 0; i < result.length - 1; i += 1) {
    const current = result[i];
    const next = result[i + 1];
    if (current.startTick === next.startTick) continue;

    const currentEnd = current.startTick + current.durationTicks;
    if (currentEnd < next.startTick) {
      current.durationTicks = next.startTick - current.startTick;
    }
  }
  return result;
}

/** Inserts a fresh `RestEvent` for every remaining silent gap between consecutive events (already sorted by `startTick`). */
function applyFillGaps(sorted: MusicalEvent[], trackId: string, voiceId: string): MusicalEvent[] {
  const result: MusicalEvent[] = [];
  let cursor: number | null = null;

  for (const event of sorted) {
    if (cursor !== null && event.startTick > cursor) {
      result.push({
        id: createId(),
        startTick: cursor,
        durationTicks: event.startTick - cursor,
        voiceId,
        trackId,
      });
    }
    result.push(event);
    const end = event.startTick + event.durationTicks;
    cursor = cursor === null ? end : Math.max(cursor, end);
  }

  return result;
}

/** Runs the chord-grouping/overlap-resolution/legato/gap-filling stages (each opt-in) over one (trackId, voiceId) group. */
function processVoiceGroup(group: MusicalEvent[], opts: QuantizeOptions): MusicalEvent[] {
  let current = [...group].sort((a, b) => a.startTick - b.startTick);

  if (opts.chordToleranceTicks !== undefined) {
    current = applyChordGrouping(current, opts.chordToleranceTicks);
  }
  if (opts.resolveOverlaps) {
    current = applyResolveOverlaps(current);
  }
  if (opts.legatoCleanup) {
    current = applyLegatoCleanup(current);
  }
  if (opts.fillGaps) {
    const [{ trackId, voiceId }] = group;
    current = applyFillGaps(current, trackId, voiceId);
  }

  return current;
}

/**
 * Quantizes `events` per `opts` (spec §24): drops undersized notes, snaps
 * starts (grid/triplet/swing/humanize tolerance) and durations (grid,
 * clamped to a minimum), then — per (trackId, voiceId) group — clusters
 * near-simultaneous onsets into chords, resolves overlaps, closes gaps
 * (legato), and fills remaining silence with rests. Every stage after
 * dropping is opt-in via `opts`; omitting a field disables that stage.
 * Returns a new array; never mutates `events` or its elements.
 */
export function quantizeEvents(events: MusicalEvent[], opts: QuantizeOptions): MusicalEvent[] {
  const survivors = dropShortNotes(events, opts.minDurationTicks);

  const withStarts = survivors.map((event) =>
    opts.quantizeStarts
      ? { ...event, startTick: computeSnappedStart(event.startTick, opts) }
      : { ...event },
  );

  const withDurations = withStarts.map((event) =>
    opts.quantizeDurations
      ? { ...event, durationTicks: computeSnappedDuration(event.durationTicks, opts) }
      : event,
  );

  return groupByVoice(withDurations)
    .map((group) => processVoiceGroup(group, opts))
    .flat();
}
