import { describe, expect, it } from 'vitest';
import { snapshotTree } from './snapshot-tree.js';
import type { SnapshotSummary } from '@sudobility/music_types';

/** `[id, parentId]` pairs, oldest first. */
function summaries(pairs: Array<[string, string | null]>): SnapshotSummary[] {
  return pairs.map(([id, parentId], i) => ({
    id,
    projectId: 'p',
    parentId,
    name: `Version ${i + 1}`,
    createdAt: new Date(2026, 0, i + 1).toISOString(),
  }));
}

describe('snapshotTree', () => {
  it('puts each snapshot one generation below its parent', () => {
    const nodes = snapshotTree(
      summaries([
        ['a', null],
        ['b', 'a'],
        ['c', 'b'],
      ]),
      'c'
    );
    expect(nodes.find(n => n.id === 'a')!.depth).toBe(0);
    expect(nodes.find(n => n.id === 'b')!.depth).toBe(1);
    expect(nodes.find(n => n.id === 'c')!.depth).toBe(2);
  });

  it('gives siblings different lanes so a branch is visible', () => {
    // a ── b
    //  └── c
    const nodes = snapshotTree(
      summaries([
        ['a', null],
        ['b', 'a'],
        ['c', 'a'],
      ]),
      'c'
    );
    const b = nodes.find(n => n.id === 'b')!;
    const c = nodes.find(n => n.id === 'c')!;
    expect(b.depth).toBe(c.depth);
    expect(b.lane).not.toBe(c.lane);
  });

  it('adds a live node hanging off the snapshot the work descends from', () => {
    // The question the screen exists to answer: you are here.
    const nodes = snapshotTree(
      summaries([
        ['a', null],
        ['b', 'a'],
      ]),
      'b'
    );
    const live = nodes.find(n => n.isLive)!;
    expect(live.parentId).toBe('b');
    expect(live.depth).toBe(2);
  });

  it('roots the live node when the project has never been snapshotted', () => {
    const nodes = snapshotTree([], null);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].isLive).toBe(true);
    expect(nodes[0].depth).toBe(0);
  });

  it('keeps an orphan reachable rather than dropping it', () => {
    // A parent could be missing if data is ever partially loaded; a node that
    // vanishes from the picker is worse than one drawn at the root.
    const nodes = snapshotTree(summaries([['b', 'gone']]), 'b');
    expect(nodes.some(n => n.id === 'b')).toBe(true);
  });

  it('places every snapshot exactly once', () => {
    const input = summaries([
      ['a', null],
      ['b', 'a'],
      ['c', 'a'],
      ['d', 'c'],
    ]);
    const nodes = snapshotTree(input, 'd').filter(n => !n.isLive);
    expect(nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
