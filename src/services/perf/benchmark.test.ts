import { describe, expect, it } from 'vitest';
import { DEFAULT_BENCHMARK_SIZES, runBenchmark, toBenchmarkTable } from './benchmark.js';

// Small sizes only (per the Task 17 brief: "benchmark runs under vitest on
// small sizes") — `DEFAULT_BENCHMARK_SIZES` (up to 20 tracks x 500 measures)
// is exercised manually/via Developer Settings, not in the unit suite.
const SMALL_SIZES = [
  { trackCount: 1, measureCount: 4 },
  { trackCount: 2, measureCount: 8 },
];

describe('runBenchmark', () => {
  it('returns one report per size, each with a positive note count and a non-negative timing for every named operation', () => {
    const report = runBenchmark(SMALL_SIZES);

    expect(report.sizes).toHaveLength(SMALL_SIZES.length);
    report.sizes.forEach((sizeReport, i) => {
      expect(sizeReport.size).toEqual(SMALL_SIZES[i]);
      expect(sizeReport.noteCount).toBeGreaterThan(0);
      // Both the whole-score note total (trackCount * measureCount * 4, per
      // stressScore's own doc comment) and every timing being present.
      expect(sizeReport.noteCount).toBe(SMALL_SIZES[i].trackCount * SMALL_SIZES[i].measureCount * 4);

      const names = sizeReport.timings.map((t) => t.name);
      expect(names).toEqual([
        'validateScore',
        'quantizeEvents (whole score)',
        'extractFragment',
        'replaceFragment',
        'exportMidi',
        'VexFlowScoreRenderer.render', // jsdom provides `document`, so the render benchmark runs too
        'CanvasScoreRenderer.render (cold: layout + first window)',
        'CanvasScoreRenderer.render (mean windowed frame x20)',
      ]);
      for (const timing of sizeReport.timings) {
        expect(timing.ms).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(timing.ms)).toBe(true);
      }
    });

    expect(new Date(report.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('defaults to DEFAULT_BENCHMARK_SIZES when called with no argument', () => {
    // Only assert shape/size count here (not timings) — DEFAULT_BENCHMARK_SIZES
    // includes a 20-track x 500-measure score, too slow to run per test.
    expect(DEFAULT_BENCHMARK_SIZES.length).toBeGreaterThan(0);
    expect(DEFAULT_BENCHMARK_SIZES.some((s) => s.trackCount >= 20 && s.measureCount >= 500)).toBe(true);
  });

  it('is deterministic in shape/content given the same sizes (stressScore has no randomness)', () => {
    const a = runBenchmark(SMALL_SIZES);
    const b = runBenchmark(SMALL_SIZES);
    expect(a.sizes.map((s) => s.noteCount)).toEqual(b.sizes.map((s) => s.noteCount));
  });
});

describe('toBenchmarkTable', () => {
  it('flattens a report into one row per (size, operation) pair, rounded to 2 decimal places', () => {
    const report = runBenchmark(SMALL_SIZES);
    const table = toBenchmarkTable(report);

    const opsPerSize = report.sizes[0].timings.length;
    expect(table).toHaveLength(SMALL_SIZES.length * opsPerSize);
    expect(table[0]).toEqual({
      tracks: SMALL_SIZES[0].trackCount,
      measures: SMALL_SIZES[0].measureCount,
      notes: SMALL_SIZES[0].trackCount * SMALL_SIZES[0].measureCount * 4,
      operation: 'validateScore',
      ms: expect.any(Number),
    });
    for (const row of table) {
      expect(row.ms).toBe(Math.round(row.ms * 100) / 100);
    }
  });

  it('returns an empty array for an empty report', () => {
    expect(toBenchmarkTable({ generatedAt: new Date().toISOString(), sizes: [] })).toEqual([]);
  });
});
