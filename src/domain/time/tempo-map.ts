import type { TempoEvent } from '@sudobility/music_types';

const DEFAULT_BPM = 120;

/** Seconds elapsed for a given tick delta at a constant bpm. */
function deltaTicksToSeconds(deltaTicks: number, ppq: number, bpm: number): number {
  return (deltaTicks / ppq) * (60 / bpm);
}

/** A point where the effective tempo changes, with its precomputed tick/seconds offset. */
type Breakpoint = { tick: number; seconds: number; bpm: number };

/**
 * Maps between ticks and seconds given a (possibly empty) set of tempo
 * change events. Tempo is piecewise-constant (a bpm value applies from its
 * event's tick until the next event's tick), which makes the tick <-> second
 * mapping piecewise-linear. An empty map behaves as a constant 120 bpm.
 */
export class TempoMap {
  private readonly breakpoints: Breakpoint[];
  private readonly ppq: number;

  constructor(events: TempoEvent[], ppq: number) {
    this.ppq = ppq;
    this.breakpoints = TempoMap.buildBreakpoints(events, ppq);
  }

  private static buildBreakpoints(events: TempoEvent[], ppq: number): Breakpoint[] {
    const sorted = [...events].sort((a, b) => a.tick - b.tick);
    const breakpoints: Breakpoint[] = [];

    let currentTick = 0;
    let currentSeconds = 0;
    let currentBpm = DEFAULT_BPM;

    if (sorted.length === 0 || sorted[0].tick > 0) {
      breakpoints.push({ tick: 0, seconds: 0, bpm: DEFAULT_BPM });
    }

    for (const event of sorted) {
      if (event.tick === currentTick && breakpoints.length > 0) {
        // Event at the same tick as the running breakpoint: it overrides
        // the bpm effective from that tick (no time has elapsed).
        breakpoints[breakpoints.length - 1] = {
          tick: event.tick,
          seconds: currentSeconds,
          bpm: event.bpm,
        };
        currentBpm = event.bpm;
        continue;
      }

      currentSeconds += deltaTicksToSeconds(event.tick - currentTick, ppq, currentBpm);
      currentTick = event.tick;
      breakpoints.push({ tick: currentTick, seconds: currentSeconds, bpm: event.bpm });
      currentBpm = event.bpm;
    }

    return breakpoints;
  }

  /** Finds the last breakpoint at or before `tick` (breakpoints[0].tick is always 0). */
  private breakpointForTick(tick: number): Breakpoint {
    let result = this.breakpoints[0];
    for (const bp of this.breakpoints) {
      if (bp.tick > tick) break;
      result = bp;
    }
    return result;
  }

  /** Finds the last breakpoint whose seconds offset is at or before `seconds`. */
  private breakpointForSeconds(seconds: number): Breakpoint {
    let result = this.breakpoints[0];
    for (const bp of this.breakpoints) {
      if (bp.seconds > seconds) break;
      result = bp;
    }
    return result;
  }

  /** The bpm in effect at the given tick. */
  bpmAt(tick: number): number {
    return this.breakpointForTick(tick).bpm;
  }

  /** Converts an integer tick position to seconds. */
  ticksToSeconds(tick: number): number {
    const bp = this.breakpointForTick(tick);
    return bp.seconds + deltaTicksToSeconds(tick - bp.tick, this.ppq, bp.bpm);
  }

  /** Converts a time in seconds to a (possibly fractional) tick position. */
  secondsToTicks(seconds: number): number {
    const bp = this.breakpointForSeconds(seconds);
    const deltaSeconds = seconds - bp.seconds;
    return bp.tick + deltaSeconds * (bp.bpm / 60) * this.ppq;
  }
}
