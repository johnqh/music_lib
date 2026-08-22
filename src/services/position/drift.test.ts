/**
 * How far the caret can sit from the music, measured.
 *
 * The bug this quantifies: the caret used to be projected forward from an
 * anchor stamped when **React delivered** a position report, while the note
 * highlighting and the piano keyboard were driven by the engine's own sounding
 * set. Those two clocks differ by however long delivery took, so under load
 * the caret and the highlights drifted apart on screen.
 *
 * Simulated rather than measured in a browser because the quantity that
 * matters is arithmetic: reports arrive from Tone's lookahead loop in clumps,
 * and the anchor is either stamped at the engine's time or at delivery time.
 * A fake clock makes the difference exact and the result reproducible.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { MusicPosition } from './music-position.js';

/** 120bpm at 480ppq: two quarters a second, so 960 ticks a second. */
const TICKS_PER_SECOND = 960;

/**
 * When the engine actually samples position — deliberately uneven.
 *
 * Tone schedules these through its lookahead loop rather than a wall clock, so
 * they land in bursts. Even spacing would hide the very thing interpolation
 * exists to smooth.
 */
const REPORT_TIMES = [
  0, 0.004, 0.009, 0.1, 0.104, 0.11, 0.2, 0.207, 0.3, 0.31, 0.315, 0.4,
];

/** Ground truth: where the music genuinely is at `t` seconds. */
const trueTick = (t: number): number => t * TICKS_PER_SECOND;

let clock = 0;

function useFakeClock(): void {
  vi.spyOn(performance, 'now').mockImplementation(() => clock * 1000);
}

afterEach(() => vi.restoreAllMocks());

/**
 * Worst caret error over a 60fps sampling of the whole run.
 *
 * `deliveryLatency` models the gap between the engine taking a sample and a
 * React subscriber acting on it. `anchorOnEngineClock` picks the strategy:
 * true passes the engine's own timestamp (what the code does now), false lets
 * the anchor default to "whenever this call happened" (what it used to do).
 */
function worstError(
  deliveryLatency: number,
  anchorOnEngineClock: boolean
): number {
  clock = 0;
  const position = new MusicPosition();
  position.setPlaying(true, TICKS_PER_SECOND);

  let worst = 0;
  let reportIndex = 0;
  for (let frame = 0; frame <= 0.4; frame += 1 / 60) {
    // Deliver every report whose latency has elapsed by this frame.
    while (
      reportIndex < REPORT_TIMES.length &&
      REPORT_TIMES[reportIndex] + deliveryLatency <= frame
    ) {
      const sampledAt = REPORT_TIMES[reportIndex];
      clock = sampledAt + deliveryLatency;
      position.report(
        trueTick(sampledAt),
        anchorOnEngineClock ? sampledAt : undefined
      );
      reportIndex += 1;
    }
    clock = frame;
    worst = Math.max(worst, Math.abs(position.tick - trueTick(frame)));
  }
  return worst;
}

describe('caret drift against the audio clock', () => {
  it('anchoring on the engine clock tracks the music exactly', () => {
    useFakeClock();
    // Zero, not "small": the anchor and the projection are both in engine
    // time, so the arithmetic is exact whatever the delivery latency.
    expect(worstError(0.03, true)).toBeLessThan(1e-6);
    expect(worstError(0.12, true)).toBeLessThan(1e-6);
  });

  it('anchoring on delivery time lags by latency times the tick rate', () => {
    useFakeClock();
    // 30ms of delivery latency at 960 ticks/sec is ~28.8 ticks — six percent
    // of a quarter note, and the caret sits that far behind the note the
    // highlighting has already lit.
    expect(worstError(0.03, false)).toBeGreaterThan(25);
    // Under load it gets worse in proportion: 120ms is ~115 ticks, a quarter
    // of a beat, which is the "sometimes it's just wrong" the report described.
    expect(worstError(0.12, false)).toBeGreaterThan(100);
  });

  it('the engine-clock anchor is dramatically better at every latency', () => {
    useFakeClock();
    for (const latency of [0.01, 0.03, 0.06, 0.12]) {
      expect(worstError(latency, true)).toBeLessThan(
        worstError(latency, false)
      );
    }
  });
});
