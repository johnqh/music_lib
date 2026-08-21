/**
 * Translating between where the music *is written* and where it is *played*.
 *
 * Without repeats these are the same number, and the whole editor was built on
 * that: the caret is a score tick, `seek` takes a score tick, the
 * following-scroll finds a bar from one. Expanding a repeat breaks the
 * identity — bar 3 played twice has two performance positions and one written
 * position — so rather than teach four separate consumers about repeats, the
 * plan carries this timeline and they translate through it.
 *
 * A score with no repeats produces an identity timeline: one segment covering
 * everything, `performanceTick === sourceTick`. That is what keeps every
 * existing behaviour byte-identical.
 */
import type {
  PerformanceTimeline,
  Score,
  TimelineSegment,
} from '@sudobility/music_types';
import { repeatPlayOrder } from './repeat-order.js';

// The shape lives in music_types beside `PlaybackPlan`, which carries it —
// this module builds one rather than declaring a second copy of the type.
export type { PerformanceTimeline, TimelineSegment };

/**
 * Builds the timeline for `score`, honouring its repeats.
 *
 * Consecutive played bars are merged into one segment: a piece with no repeats
 * becomes a single identity segment, and even a repeated one has a handful —
 * so the lookups below stay cheap enough to run per animation frame.
 */
export function performanceTimeline(score: Score): PerformanceTimeline {
  const measures = score.tracks[0]?.measures ?? [];
  // Mutable while building, handed back as the readonly contract type.
  const segments: Array<{
    performanceTick: number;
    sourceTick: number;
    durationTicks: number;
  }> = [];
  let performanceTick = 0;

  for (const { measureIndex } of repeatPlayOrder(score)) {
    const measure = measures[measureIndex];
    if (!measure) continue;

    const previous = segments[segments.length - 1];
    const continues =
      previous !== undefined &&
      previous.sourceTick + previous.durationTicks === measure.startTick;

    if (continues) {
      previous.durationTicks += measure.durationTicks;
    } else {
      segments.push({
        performanceTick,
        sourceTick: measure.startTick,
        durationTicks: measure.durationTicks,
      });
    }
    performanceTick += measure.durationTicks;
  }

  return { segments, durationTicks: performanceTick };
}

/**
 * Where on the page a performance position is.
 *
 * Used by everything that draws: the caret, the following-scroll, the bar/beat
 * readout. A tick past the end clamps to the last segment rather than
 * returning nothing, because the engine can report a position a hair past the
 * final note and the caret should sit at the end rather than vanish.
 */
export function sourceTickFor(
  timeline: PerformanceTimeline,
  performanceTick: number
): number {
  const { segments } = timeline;
  if (segments.length === 0) return performanceTick;

  for (const segment of segments) {
    const offset = performanceTick - segment.performanceTick;
    if (offset >= 0 && offset < segment.durationTicks) {
      return segment.sourceTick + offset;
    }
  }

  const last = segments[segments.length - 1];
  if (performanceTick < segments[0].performanceTick)
    return segments[0].sourceTick;
  return last.sourceTick + last.durationTicks - 1;
}

/**
 * Where to start playing to hear a written position.
 *
 * The **first** time that written tick is performed, deliberately: clicking bar
 * 3 and pressing play should start the first time through, which is what
 * "play from here" means to a reader looking at the page. Hearing the repeat
 * means playing on to it.
 */
export function performanceTickFor(
  timeline: PerformanceTimeline,
  sourceTick: number
): number {
  for (const segment of timeline.segments) {
    const offset = sourceTick - segment.sourceTick;
    if (offset >= 0 && offset < segment.durationTicks) {
      return segment.performanceTick + offset;
    }
  }
  return sourceTick;
}
