/**
 * Benchmark/performance-test utility for large scores (spec §29: "Provide a
 * benchmark/performance-test utility using generated scores." — spec §29's
 * stated targets are "≥20 tracks; ≥500 measures; ≥20,000 note events").
 *
 * Times the perf-relevant domain/adapter operations named in the Task 17
 * brief — `validateScore`, `quantizeEvents`, `extractFragment`/
 * `replaceFragment`, `exportMidi`, and `CanvasScoreRenderer.render` (cold
 * layout + windowed frames) — against `stressScore`-generated scores
 * (Task 3's deterministic, allocation-light fixture generator) of
 * caller-chosen sizes.
 *
 * Wired into Developer Settings (spec §33): "Generate stress-test score"
 * uses the same `stressScore` generator this module benchmarks against,
 * and a "Run benchmark" action (`DeveloperSettingsDialog.tsx`) calls
 * `runBenchmark` and both logs `toBenchmarkTable`'s rows via
 * `console.table` and folds the raw `BenchmarkReport` into the "Export
 * diagnostic JSON" download.
 */
import { stressScore } from '../../test/fixtures.js';
import type { MidiCodec, Score } from '@sudobility/music_types';
import type { ScoreRange } from '@sudobility/music_types';
import { validateScore } from '@sudobility/music_types';
import { quantizeEvents } from '@sudobility/music_types';
import { allNotes } from '@sudobility/music_types';
import { extractFragment, replaceFragment } from '@sudobility/music_types';
import { exportMidi } from '@sudobility/music_codecs';
import { CanvasScoreRenderer } from '@sudobility/music_drawing';
import { createMock2DContext } from '../../test/canvas-stub.js';
import type { RenderTheme } from '@sudobility/music_drawing';

export type BenchmarkSize = { trackCount: number; measureCount: number };

export type BenchmarkTiming = { name: string; ms: number };

export type BenchmarkSizeReport = {
  size: BenchmarkSize;
  noteCount: number;
  timings: BenchmarkTiming[];
};

export type BenchmarkReport = {
  generatedAt: string;
  sizes: BenchmarkSizeReport[];
};

/**
 * Default benchmark sizes: a couple of smaller scores so a run's trend is
 * visible (not just one data point), plus spec §29's stated floor (≥20
 * tracks, ≥500 measures — at 4 notes/measure/track this also clears the
 * "≥20,000 note events" target: 20 * 500 * 4 = 40,000). Callers (e.g. a
 * future CLI runner, or a caller wanting a faster smoke check) may pass
 * their own sizes instead.
 */
export const DEFAULT_BENCHMARK_SIZES: BenchmarkSize[] = [
  { trackCount: 4, measureCount: 50 },
  { trackCount: 10, measureCount: 200 },
  { trackCount: 20, measureCount: 500 },
];

const RENDER_WIDTH = 900;
const RENDER_THEME: RenderTheme = {
  foreground: '#111111',
  noteNormal: '#111111',
  noteInactive: '#777777',
  noteSelected: '#000000',
  noteRegenerated: '#8b5a2b',
  notePlaying: '#0066ff',
  staveActive: '#000000',
  staveInactive: '#666666',
  caret: '#d32f2f',
};

/** Wall-clock milliseconds, via `performance.now()` where available (sub-millisecond, monotonic) or `Date.now()` otherwise. */
function now(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Runs `fn`, returning both its result and the elapsed wall-clock time. */
function time<T>(fn: () => T): { result: T; ms: number } {
  const start = now();
  const result = fn();
  return { result, ms: now() - start };
}

/**
 * A representative mid-score tick range (the middle third of the first
 * track's measures) for `extractFragment`/`replaceFragment` timing —
 * deliberately not the *whole* score (that would just measure a full-score
 * round-trip, not a realistic single editing/regeneration operation).
 * Every track is included (`trackIds: score.tracks.map(...)`), matching how
 * a real multi-track regeneration/copy targets more than one track at once.
 */
function representativeRange(score: Score): ScoreRange {
  const trackIds = score.tracks.map(t => t.id);
  const measures = score.tracks[0]?.measures ?? [];
  if (measures.length === 0) return { startTick: 0, endTick: 0, trackIds };

  const startIndex = Math.floor(measures.length / 3);
  const endIndex = Math.min(
    measures.length - 1,
    Math.floor((measures.length * 2) / 3)
  );
  const endMeasure = measures[endIndex];
  return {
    startTick: measures[startIndex].startTick,
    endTick: endMeasure.startTick + endMeasure.durationTicks,
    trackIds,
  };
}

/** Benchmarks every perf-relevant operation named in the Task 17 brief against one `stressScore(size.trackCount, size.measureCount)`. */
function benchmarkSize(
  size: BenchmarkSize,
  codec: MidiCodec
): BenchmarkSizeReport {
  const score = stressScore(size.trackCount, size.measureCount);
  const timings: BenchmarkTiming[] = [];

  const validateTiming = time(() => validateScore(score));
  timings.push({ name: 'validateScore', ms: validateTiming.ms });

  const notes = allNotes(score);
  const quantizeTiming = time(() =>
    quantizeEvents(notes, {
      grid: score.ppq / 4,
      quantizeStarts: true,
      quantizeDurations: true,
    })
  );
  timings.push({ name: 'quantizeEvents (whole score)', ms: quantizeTiming.ms });

  const range = representativeRange(score);
  const extractTiming = time(() => extractFragment(score, range));
  timings.push({ name: 'extractFragment', ms: extractTiming.ms });

  const replaceTiming = time(() =>
    replaceFragment(score, extractTiming.result)
  );
  timings.push({ name: 'replaceFragment', ms: replaceTiming.ms });

  const exportTiming = time(() => exportMidi(score, codec));
  timings.push({ name: 'exportMidi', ms: exportTiming.ms });

  // Canvas renderer (windowed): timed against the recording mock context, so
  // this measures our orchestration + VexFlow layout/format math, not GPU
  // raster time — exactly the part that must stay O(visible). "Cold"
  // includes the one allowed O(n) layout pass; the warm number is the mean
  // per-frame cost of scrolling through 20 different viewports.
  {
    const canvasRenderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext(RENDER_WIDTH, 400);
    const opts = {
      zoom: 1,
      layoutMode: 'page' as const,
      width: RENDER_WIDTH,
      theme: RENDER_THEME,
      viewport: { top: 0, bottom: 400 },
    };
    try {
      const coldTiming = time(() => canvasRenderer.render(score, ctx, opts));
      timings.push({
        name: 'CanvasScoreRenderer.render (cold: layout + first window)',
        ms: coldTiming.ms,
      });

      const frames = 20;
      const warmTiming = time(() => {
        for (let i = 0; i < frames; i += 1) {
          canvasRenderer.render(score, ctx, {
            ...opts,
            viewport: { top: i * 100, bottom: i * 100 + 400 },
          });
        }
      });
      timings.push({
        name: 'CanvasScoreRenderer.render (mean windowed frame x20)',
        ms: warmTiming.ms / frames,
      });
    } finally {
      canvasRenderer.dispose();
    }
  }

  return { size, noteCount: notes.length, timings };
}

/**
 * Runs the full benchmark suite (spec §29's "benchmark/performance-test
 * utility using generated scores") across `sizes` (default:
 * `DEFAULT_BENCHMARK_SIZES`). Inputs are deterministic (`stressScore`);
 * the resulting timings are, as always with wall-clock measurement, only
 * meaningful relative to the machine/run they were captured on.
 */
export function runBenchmark(
  codec: MidiCodec,
  sizes: BenchmarkSize[] = DEFAULT_BENCHMARK_SIZES
): BenchmarkReport {
  return {
    generatedAt: new Date().toISOString(),
    sizes: sizes.map(size => benchmarkSize(size, codec)),
  };
}

export type BenchmarkTableRow = {
  tracks: number;
  measures: number;
  notes: number;
  operation: string;
  ms: number;
};

/**
 * Flattens a `BenchmarkReport` into one row per (size, operation) pair,
 * shaped for `console.table` — kept separate from `runBenchmark` so a
 * caller wanting the raw, nested report (e.g. the diagnostic-JSON export)
 * isn't stuck with the flattened/rounded table shape instead.
 */
export function toBenchmarkTable(report: BenchmarkReport): BenchmarkTableRow[] {
  const rows: BenchmarkTableRow[] = [];
  for (const sizeReport of report.sizes) {
    for (const timing of sizeReport.timings) {
      rows.push({
        tracks: sizeReport.size.trackCount,
        measures: sizeReport.size.measureCount,
        notes: sizeReport.noteCount,
        operation: timing.name,
        ms: Math.round(timing.ms * 100) / 100,
      });
    }
  }
  return rows;
}
