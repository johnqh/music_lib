/**
 * Which systems go on which page, and where a page turn should fall.
 *
 * Pure over a `LayoutPlan` — no DOM, no canvas, no React — so the decisions
 * about paper and page turns are testable without printing anything.
 *
 * Feature 1 left pagination to the browser: every system was a block with
 * `break-inside: avoid`, and the browser fitted as many as the paper allowed.
 * That has no opinion about *where* the break falls, and a turn in the middle
 * of a phrase costs a real player a hand.
 */
import { isSilentMeasure } from '../../domain/score/collapse-rests.js';
import type { Measure, Track } from '@sudobility/music_types';
import type { LayoutPlan, SystemLayout } from './layout.js';

export type PaperSize = 'a4' | 'letter' | 'legal';
export type PaperOrientation = 'portrait' | 'landscape';

/** Portrait dimensions in millimetres; landscape swaps them. */
export const PAPER_DIMENSIONS_MM: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 }, // 8.5in x 11in
  legal: { width: 215.9, height: 355.6 }, // 8.5in x 14in
};

/**
 * The margin the printed page reserves on every side.
 *
 * The single source: the `@page` rule is emitted from this, and the height
 * below is computed from it. Two numbers here means pagination that silently
 * disagrees with what the printer does.
 */
export const PAGE_MARGIN_MM = 12;

/**
 * How much height `logicalWidth` units of layout buy on this paper.
 *
 * Paper only ever enters as a ratio: the layout is computed at a fixed logical
 * width and each page is displayed at the paper's printable width, so the
 * scale is uniform and millimetres cancel.
 */
export function usablePageHeight(
  paper: PaperSize,
  orientation: PaperOrientation,
  logicalWidth: number,
  marginMm: number = PAGE_MARGIN_MM,
): number {
  const { width, height } = PAPER_DIMENSIONS_MM[paper];
  const shortSide = orientation === 'portrait' ? width : height;
  const longSide = orientation === 'portrait' ? height : width;
  return (logicalWidth * (longSide - 2 * marginMm)) / (shortSide - 2 * marginMm);
}

/** The systems printed on one page, by index into `LayoutPlan.systems`. */
export type PrintPage = { systemIndices: number[] };

/** A system's full printed height, measure-number band included. */
function systemHeight(system: SystemLayout): number {
  return system.yBottom - system.gutterTop;
}

/**
 * How many systems earlier than the greedy break a page may end.
 *
 * Two. Every system pulled back makes the part longer, and a turn bought three
 * systems early costs more paper than it saves the player.
 */
export const MAX_PULL_BACK = 2;

/** How many bars `measure` stands for — a multi-measure rest stands for its count. */
function barSpan(measure: Measure): number {
  return measure.multiMeasureRestCount ?? 1;
}

/** Silent bars at the end of `indices`. */
function trailingFreeBars(track: Track, indices: readonly number[]): number {
  let bars = 0;
  for (let i = indices.length - 1; i >= 0; i -= 1) {
    const measure = track.measures[indices[i]];
    if (!measure || !isSilentMeasure(measure)) break;
    bars += barSpan(measure);
  }
  return bars;
}

/** Silent bars at the start of `indices`. */
function leadingFreeBars(track: Track, indices: readonly number[]): number {
  let bars = 0;
  for (const index of indices) {
    const measure = track.measures[index];
    if (!measure || !isSilentMeasure(measure)) break;
    bars += barSpan(measure);
  }
  return bars;
}

/**
 * Bars `track`'s player has free across a turn taken after system
 * `lastSystemIndex`.
 *
 * They may begin turning once their last note on the page has finished and
 * must be reading again by their first on the next, so both sides count.
 * Zero after the last system: there is no turn there.
 */
export function turnFreeBars(plan: LayoutPlan, track: Track, lastSystemIndex: number): number {
  const last = plan.systems[lastSystemIndex];
  const next = plan.systems[lastSystemIndex + 1];
  if (!last || !next) return 0;
  return trailingFreeBars(track, last.measureIndices) + leadingFreeBars(track, next.measureIndices);
}

/**
 * The end index (exclusive) that buys the best turn, at most `MAX_PULL_BACK`
 * systems back from `greedyEnd` and never emptying the page.
 *
 * Searched downward with a strict improvement test, so a tie keeps the fullest
 * page — pulling back with nothing to show for it is pure loss.
 */
function bestTurn(plan: LayoutPlan, track: Track, start: number, greedyEnd: number): number {
  let best = greedyEnd;
  let bestScore = turnFreeBars(plan, track, greedyEnd - 1);

  const earliest = Math.max(start + 1, greedyEnd - MAX_PULL_BACK);
  for (let end = greedyEnd - 1; end >= earliest; end -= 1) {
    const score = turnFreeBars(plan, track, end - 1);
    if (score > bestScore) {
      best = end;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Which systems go on which page.
 *
 * Greedy: take systems in order while they fit. A system taller than the page
 * still gets its own page — it overflows, which is better than dropping it and
 * better than never advancing.
 *
 * With `turnTrack`, each break is then pulled back up to `MAX_PULL_BACK`
 * systems if that buys its player a better page turn.
 */
export function paginate(
  plan: LayoutPlan,
  pageHeight: number,
  turnTrack?: Track,
): PrintPage[] {
  const pages: PrintPage[] = [];
  let start = 0;

  while (start < plan.systems.length) {
    let end = start;
    let used = 0;

    while (end < plan.systems.length) {
      const height = systemHeight(plan.systems[end]);
      // `end > start` is what guarantees progress: the first system on a page
      // always goes on it, however tall it is.
      if (end > start && used + height > pageHeight) break;
      used += height;
      end += 1;
    }

    // Only worth doing when there *is* a turn: the last page ends the piece.
    // A whole-score print passes no track — "the player rests" means nothing
    // when a dozen staves share the page, and a conductor turns at will.
    if (turnTrack && end < plan.systems.length) {
      end = bestTurn(plan, turnTrack, start, end);
    }

    const systemIndices: number[] = [];
    for (let i = start; i < end; i += 1) systemIndices.push(i);
    pages.push({ systemIndices });
    start = end;
  }

  return pages;
}
