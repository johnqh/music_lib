import { describe, expect, it } from 'vitest';
import {
  MAX_PULL_BACK,
  PAGE_MARGIN_MM,
  PAPER_DIMENSIONS_MM,
  paginate,
  turnFreeBars,
  usablePageHeight,
} from './pagination.js';
import type { LayoutPlan, SystemLayout } from './layout.js';
import type { Measure, Score, Track } from '@sudobility/music_types';
import { computeLayout } from './layout.js';
import { createEmptyScore } from '../../domain/score/factory.js';
import { extractPart } from '../../domain/score/extract-part.js';
import { addNoteCommand } from '../../domain/commands/note-commands.js';
import { testRenderTheme } from '../../test/fixtures.js';
describe('usablePageHeight', () => {
  it('is the logical width scaled by the printable aspect ratio', () => {
    // A4 portrait at a 12mm margin: 186mm x 273mm printable, so 1000 logical
    // units of width buys 1000 * 273 / 186 of height.
    expect(usablePageHeight('a4', 'portrait', 1000)).toBeCloseTo((1000 * 273) / 186, 4);
  });

  it('swaps the dimensions for landscape', () => {
    expect(usablePageHeight('a4', 'landscape', 1000)).toBeCloseTo((1000 * 186) / 273, 4);
  });

  it('gives a portrait page more height than a landscape one', () => {
    // The whole reason the picker exists: paper shape changes what fits.
    for (const paper of ['a4', 'letter', 'legal'] as const) {
      expect(usablePageHeight(paper, 'portrait', 1000)).toBeGreaterThan(
        usablePageHeight(paper, 'landscape', 1000),
      );
    }
  });

  it('gives legal more height than letter, which is the same width', () => {
    expect(PAPER_DIMENSIONS_MM.legal.width).toBe(PAPER_DIMENSIONS_MM.letter.width);
    expect(usablePageHeight('legal', 'portrait', 1000)).toBeGreaterThan(
      usablePageHeight('letter', 'portrait', 1000),
    );
  });

  it('scales with the logical width', () => {
    expect(usablePageHeight('a4', 'portrait', 2000)).toBeCloseTo(
      2 * usablePageHeight('a4', 'portrait', 1000),
      4,
    );
  });

  it('takes a margin, defaulting to the one the printed page uses', () => {
    expect(usablePageHeight('a4', 'portrait', 1000, PAGE_MARGIN_MM)).toBe(
      usablePageHeight('a4', 'portrait', 1000),
    );
    // A bigger margin buys *more* logical height, which is not the obvious
    // direction: it eats proportionally more of the short side than the long
    // one, so the printable area gets relatively taller. Physically, the
    // content is narrower, so the same logical width prints at a smaller
    // scale and more logical units fit down the page.
    expect(usablePageHeight('a4', 'portrait', 1000, 25)).toBeGreaterThan(
      usablePageHeight('a4', 'portrait', 1000, 12),
    );
  });
});


/** A plan of `heights.length` systems, each `heights[i]` tall, laid end to end. */
function planOf(heights: number[], indicesPerSystem: number[][] = []): LayoutPlan {
  let y = 0;
  const systems: SystemLayout[] = heights.map((height, i) => {
    const gutterTop = y;
    y += height;
    return {
      measureIndices: indicesPerSystem[i] ?? [i],
      xLeft: 0,
      xRight: 1000,
      gutterTop,
      yTop: gutterTop,
      yBottom: gutterTop + height,
    };
  });
  return { tracks: [], trackLayouts: [], systems, totalWidth: 1000, totalHeight: y };
}

const flat = (pages: { systemIndices: number[] }[]) => pages.flatMap((p) => p.systemIndices);

describe('paginate', () => {
  it('fills each page and starts a new one when the next system will not fit', () => {
    // Four 100-tall systems on a 250-tall page: 2 + 2.
    const pages = paginate(planOf([100, 100, 100, 100]), 250);
    expect(pages.map((p) => p.systemIndices)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('puts every system on exactly one page, in order', () => {
    // The invariant a pagination bug breaks first.
    const heights = [80, 120, 60, 200, 90, 140, 70];
    const pages = paginate(planOf(heights), 260);
    expect(flat(pages)).toEqual(heights.map((_, i) => i));
  });

  it('never exceeds the page height unless one system alone cannot fit', () => {
    const heights = [80, 120, 60, 200, 90, 140, 70];
    const pageHeight = 260;
    const pages = paginate(planOf(heights), pageHeight);
    for (const page of pages) {
      const used = page.systemIndices.reduce((sum, i) => sum + heights[i], 0);
      if (page.systemIndices.length > 1) expect(used).toBeLessThanOrEqual(pageHeight);
    }
  });

  it('gives a system taller than the page a page of its own', () => {
    // It will overflow. That beats dropping it, and it beats looping forever.
    const pages = paginate(planOf([100, 400, 100]), 250);
    expect(pages.map((p) => p.systemIndices)).toEqual([[0], [1], [2]]);
  });

  it('returns nothing for a plan with no systems', () => {
    expect(paginate(planOf([]), 250)).toEqual([]);
  });

  it('puts everything on one page when it all fits', () => {
    expect(paginate(planOf([50, 50, 50]), 1000).map((p) => p.systemIndices)).toEqual([[0, 1, 2]]);
  });
});


/**
 * A track of `pattern.length` measures. `null` is silent; a number is a silent
 * multi-measure rest standing for that many bars; `'note'` sounds.
 */
function trackOf(pattern: Array<'note' | null | number>): Track {
  const measures = pattern.map((entry, i) => {
    const sounding = entry === 'note';
    const measure: Measure = {
      id: `m${i}`,
      index: i,
      startTick: i * 1920,
      durationTicks: 1920,
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: { fifths: 0, mode: 'major' },
      voices: [
        {
          id: `v${i}`,
          name: 'Voice 1',
          events: sounding
            ? [
                {
                  id: `n${i}`,
                  pitch: { step: 'C', accidental: 0, octave: 4 },
                  startTick: i * 1920,
                  durationTicks: 1920,
                  velocity: 80,
                  voiceId: `v${i}`,
                  trackId: 't1',
                },
              ]
            : [{ id: `r${i}`, startTick: i * 1920, durationTicks: 1920, voiceId: `v${i}`, trackId: 't1' }],
        },
      ],
      ...(typeof entry === 'number' ? { multiMeasureRestCount: entry } : {}),
    } as Measure;
    return measure;
  });
  return { id: 't1', name: 'Solo', measures } as unknown as Track;
}

describe('turnFreeBars', () => {
  it('adds the silence at the end of the page to the silence at the start of the next', () => {
    // The player may begin turning after their last note and must be reading
    // again by their first on the next page.
    const plan = planOf([100, 100], [[0, 1], [2, 3]]);
    const track = trackOf(['note', null, null, 'note']);
    expect(turnFreeBars(plan, track, 0)).toBe(2);
  });

  it('counts a multi-measure rest for every bar it stands for', () => {
    // A 13-bar rest at the foot of a page is the best turn in the piece.
    const plan = planOf([100, 100], [[0, 1], [2, 3]]);
    const track = trackOf(['note', 13, 'note', 'note']);
    expect(turnFreeBars(plan, track, 0)).toBe(13);
  });

  it('is zero when the player is playing on both sides of the turn', () => {
    const plan = planOf([100, 100], [[0, 1], [2, 3]]);
    expect(turnFreeBars(plan, trackOf(['note', 'note', 'note', 'note']), 0)).toBe(0);
  });

  it('is zero after the last system, where there is no turn', () => {
    const plan = planOf([100, 100], [[0, 1], [2, 3]]);
    expect(turnFreeBars(plan, trackOf(['note', null, null, 'note']), 1)).toBe(0);
  });
});

describe('paginate with a turn track', () => {
  it('pulls the break back onto a rest', () => {
    // Greedy fits 3 systems and would turn where the player is playing.
    // System 1 ends silent, so ending the page there buys a real turn.
    const plan = planOf(
      [100, 100, 100, 100],
      [[0, 1], [2, 3], [4, 5], [6, 7]],
    );
    const track = trackOf(['note', 'note', 'note', null, 'note', 'note', 'note', 'note']);

    expect(paginate(plan, 350).map((p) => p.systemIndices)).toEqual([[0, 1, 2], [3]]);
    expect(paginate(plan, 350, track).map((p) => p.systemIndices)).toEqual([[0, 1], [2, 3]]);
  });

  it('does not pull back when the greedy break is already the best turn', () => {
    // Ties go to the fullest page: pulling back for nothing is pure loss.
    const plan = planOf([100, 100, 100, 100], [[0, 1], [2, 3], [4, 5], [6, 7]]);
    const track = trackOf(['note', 'note', 'note', 'note', 'note', null, 'note', 'note']);
    expect(paginate(plan, 350, track).map((p) => p.systemIndices)).toEqual([[0, 1, 2], [3]]);
  });

  it('never pulls back more than MAX_PULL_BACK systems', () => {
    // A perfect turn four systems back is out of reach; the page stays full.
    const indices = [[0], [1], [2], [3], [4], [5]];
    const plan = planOf([100, 100, 100, 100, 100, 100], indices);
    const track = trackOf([null, 'note', 'note', 'note', 'note', 'note']);
    // Exact, not a bound: the reachable candidates all score 0, so the page
    // must stay exactly as greedy left it.
    expect(paginate(plan, 550, track)[0].systemIndices).toEqual([0, 1, 2, 3, 4]);
    expect(MAX_PULL_BACK).toBe(2);
  });

  it('never pulls back to an empty page', () => {
    // The only system that fits ends where the player is playing; it still has
    // to go somewhere.
    const plan = planOf([300, 300], [[0], [1]]);
    const track = trackOf(['note', 'note']);
    expect(paginate(plan, 300, track).map((p) => p.systemIndices)).toEqual([[0], [1]]);
  });

  it('leaves a whole-score print packed greedily', () => {
    const plan = planOf([100, 100, 100, 100], [[0, 1], [2, 3], [4, 5], [6, 7]]);
    const greedy = paginate(plan, 350).map((p) => p.systemIndices);
    expect(paginate(plan, 350, undefined).map((p) => p.systemIndices)).toEqual(greedy);
  });

  it('still puts every system on exactly one page, in order', () => {
    const plan = planOf([100, 100, 100, 100, 100], [[0], [1], [2], [3], [4]]);
    const track = trackOf([null, 'note', null, 'note', null]);
    expect(flat(paginate(plan, 250, track))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('paginate on a real score', () => {
  /** A 60-bar part whose player rests around every eighth bar. */
  function restfulPart(): Score {
    const base = createEmptyScore({
      title: 'Turns',
      measures: 60,
      tracks: [
        { name: 'Solo', instrumentName: 'Solo', clef: 'treble' as const },
        { name: 'Accomp', instrumentName: 'Accomp', clef: 'bass' as const },
      ],
    });
    const filled = base.tracks.reduce(
      (acc, track) =>
        track.measures.reduce(
          (inner, m) =>
            addNoteCommand({
              trackId: track.id,
              measureId: m.id,
              voiceIndex: 0,
              pitch: { step: 'C', accidental: 0, octave: 4 } as never,
              startTick: m.startTick,
              durationTicks: base.ppq,
            }).execute(inner),
          acc,
        ),
      base,
    );
    const hushed: Score = {
      ...filled,
      tracks: filled.tracks.map((t, i) =>
        i !== 0
          ? t
          : { ...t, measures: t.measures.map((m, j) => (j % 8 === 7 || j % 8 === 0 ? { ...m, voices: [] } : m)) },
      ),
    };
    return extractPart(hushed, hushed.tracks[0].id)!;
  }

  const OPTIONS = {
    zoom: 1,
    layoutMode: 'page' as const,
    width: 1000,
    theme: testRenderTheme(),
    showTrackInfo: false,
  };

  it('never turns worse than greedy would, and turns better somewhere', () => {
    // The claim on real data, not a hand-built plan: optimised breaks are at
    // least as good as greedy everywhere, and strictly better at least once.
    // Without the second half this would pass on a no-op implementation.
    const part = restfulPart();
    const plan = computeLayout(part, OPTIONS);
    const track = part.tracks[0];
    const pageHeight = usablePageHeight('a4', 'portrait', 1000);

    const lastSystemOf = (pages: { systemIndices: number[] }[]) =>
      pages.slice(0, -1).map((p) => p.systemIndices[p.systemIndices.length - 1]);

    const greedy = lastSystemOf(paginate(plan, pageHeight));
    const tuned = lastSystemOf(paginate(plan, pageHeight, track));

    expect(tuned.length).toBeGreaterThan(0);
    const scoreOf = (breaks: number[]) => breaks.map((i) => turnFreeBars(plan, track, i));

    const greedyScores = scoreOf(greedy);
    const tunedScores = scoreOf(tuned);

    // Compare turn for turn as far as both go: a pulled-back break shifts the
    // ones after it, so only the leading pages are directly comparable.
    const shared = Math.min(greedyScores.length, tunedScores.length);
    for (let i = 0; i < shared; i += 1) {
      expect(tunedScores[i]).toBeGreaterThanOrEqual(greedyScores[i]);
    }
    expect(tunedScores.slice(0, shared).some((s, i) => s > greedyScores[i])).toBe(true);
  });

  it('still prints every system exactly once, in order', () => {
    const part = restfulPart();
    const plan = computeLayout(part, OPTIONS);
    const pages = paginate(plan, usablePageHeight('a4', 'portrait', 1000), part.tracks[0]);
    expect(flat(pages)).toEqual(plan.systems.map((_, i) => i));
  });
});
