import type { DurationName } from '@sudobility/music_types';
import { DURATIONS, ticksFor } from './ticks';

const NON_TRIPLET_DURATION_NAMES = (Object.keys(DURATIONS) as DurationName[]).filter(
  (name) => !name.startsWith('triplet-'),
);

/** Distinct, descending tick lengths for every renderable (non-triplet) duration at a given PPQ. */
function decomposableDurationTicks(ppq: number): number[] {
  const ticks = new Set(NON_TRIPLET_DURATION_NAMES.map((name) => ticksFor(name, ppq)));
  return [...ticks].filter((t) => t > 0).sort((a, b) => b - a);
}

/**
 * Greedily decomposes a tick length into the largest renderable (non-triplet,
 * dotted-allowed) note values that fit, largest first. If a remainder is
 * smaller than the smallest available duration, it is emitted as-is so the
 * returned segments always sum back to the original `ticks` (the caller is
 * responsible for deciding how such a remainder is notated/tied).
 */
export function decomposeDuration(ticks: number, ppq: number): number[] {
  if (ticks <= 0) return [];

  const candidates = decomposableDurationTicks(ppq);
  const result: number[] = [];
  let remaining = ticks;

  while (remaining > 0) {
    const next = candidates.find((c) => c <= remaining);
    if (next === undefined) {
      result.push(remaining);
      break;
    }
    result.push(next);
    remaining -= next;
  }

  return result;
}

export type TickSegment = { startTick: number; durationTicks: number };

/**
 * Splits a note spanning `[startTick, startTick + durationTicks)` at every
 * given absolute-tick boundary that falls strictly inside that range (e.g.
 * measure start ticks), returning contiguous segments that together cover
 * the original span. The caller is responsible for tying split segments
 * back together.
 */
export function splitAtBoundaries(
  startTick: number,
  durationTicks: number,
  boundaries: number[],
): TickSegment[] {
  const endTick = startTick + durationTicks;
  const cutPoints = [...new Set(boundaries)]
    .filter((b) => b > startTick && b < endTick)
    .sort((a, b) => a - b);

  const segments: TickSegment[] = [];
  let cursor = startTick;
  for (const cut of cutPoints) {
    segments.push({ startTick: cursor, durationTicks: cut - cursor });
    cursor = cut;
  }
  segments.push({ startTick: cursor, durationTicks: endTick - cursor });

  return segments;
}
