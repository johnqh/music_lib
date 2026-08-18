/**
 * What each tracker format can hold.
 *
 * Every number here is anchored to **our own decoder** rather than to the
 * format documentation, because the two only have to agree with each other for
 * a round trip to work. MOD's range is the clearest case: `period.ts` takes
 * ProTracker's C-1 period as MIDI 36, so three octaves is 36-71. A different
 * but equally defensible anchor would fail the round-trip test for reasons that
 * look like a writer bug.
 *
 * DSM and MPTM are absent deliberately: nothing reads DSM that does not read a
 * better format, and OpenMPT reads IT natively, so writing either buys nothing.
 */
import type { TrackerFormat } from '@sudobility/music_types';

/** The formats export can write. A subset of `TrackerFormat`, which import also covers. */
export type WritableTrackerFormat = 'mod' | 's3m' | 'xm' | 'it';

export type TrackerLimits = {
  channels: number;
  instruments: number;
  /** Inclusive MIDI note range this format can express. */
  lowestMidi: number;
  highestMidi: number;
};

export const TRACKER_LIMITS: Record<WritableTrackerFormat, TrackerLimits> = {
  // Three octaves, anchored on period.ts's C-1 = MIDI 36.
  mod: { channels: 4, instruments: 31, lowestMidi: 36, highestMidi: 71 },
  // s3m.ts: NOTE_BASE 12, octaves 0-7 -> 12 + 7*12 + 11 = 107.
  s3m: { channels: 32, instruments: 99, lowestMidi: 12, highestMidi: 107 },
  // xm.ts: NOTE_BASE 11, notes 1-96 -> 12..107.
  xm: { channels: 32, instruments: 128, lowestMidi: 12, highestMidi: 107 },
  // it.ts: NOTE_BASE 0, notes 0-119.
  it: { channels: 64, instruments: 99, lowestMidi: 0, highestMidi: 119 },
};

export function isWritableTrackerFormat(format: TrackerFormat): format is WritableTrackerFormat {
  return format === 'mod' || format === 's3m' || format === 'xm' || format === 'it';
}
