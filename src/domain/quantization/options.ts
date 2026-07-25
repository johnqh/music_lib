/**
 * Options for `quantizeEvents` (spec §24). All fields except `grid`,
 * `quantizeStarts`, and `quantizeDurations` are opt-in: omitting one of the
 * optional fields disables that behavior entirely (no implicit defaults are
 * substituted for them by `quantize.ts`, except a hard, undocumented-by-the-
 * caller floor of 1 tick so a returned event's `durationTicks` is never
 * <= 0 regardless of `minDurationTicks`).
 */
export type QuantizeOptions = {
  /** Grid unit in ticks (e.g. 120 ticks = a sixteenth note at 480 ppq). */
  grid: number;
  /** Snap each event's `startTick` to the grid (see `tripletGrid`/`swing`/`humanizeToleranceTicks`). */
  quantizeStarts: boolean;
  /** Snap each event's `durationTicks` to a multiple of the grid. */
  quantizeDurations: boolean;
  /**
   * Fraction (0..1) of one grid unit that every second grid slot (odd
   * slot index: 1, 3, 5, ...) is delayed by. 0 = straight (no shift);
   * 0.5 = classic swung-eighths feel; 1 = fully delayed into the next
   * slot. Only affects start quantization, and only takes effect when
   * `quantizeStarts` is true.
   */
  swing?: number;
  /** Use a triplet subdivision of `grid` (2/3 of `grid`) instead of `grid` itself when snapping starts/durations. */
  tripletGrid?: boolean;
  /**
   * Minimum allowed `durationTicks`. A `NoteEvent` whose *original*
   * duration is shorter than this is dropped entirely (`RestEvent`s are
   * never dropped). A duration that becomes shorter than this purely as a
   * quantization rounding artifact is clamped up to this floor instead of
   * being dropped.
   */
  minDurationTicks?: number;
  /**
   * If an event's original `startTick` is already within this many ticks
   * of where start-quantization would snap it, its original `startTick`
   * is kept instead of being forced onto the grid (a deterministic
   * "already close enough" tolerance; `quantize.ts` is a pure function, so
   * this is not randomized humanization).
   */
  humanizeToleranceTicks?: number;
  /**
   * Events (within the same track+voice) whose quantized start ticks fall
   * within this many ticks of one another are clustered onto a single
   * shared start tick (grouped as a chord).
   */
  chordToleranceTicks?: number;
  /** Extend each event's end to meet the next event's start in the same track+voice, closing small gaps. */
  legatoCleanup?: boolean;
  /** Trim an event that overlaps the next event's start in the same track+voice, resolving the overlap. */
  resolveOverlaps?: boolean;
  /** Insert `RestEvent`s to fill any remaining silent gaps within each track+voice. */
  fillGaps?: boolean;
};
