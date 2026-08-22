/**
 * Laying the snapshot history out as a flowchart.
 *
 * Pure over the summaries — no React, no fetching — in the same shape as
 * `print-layout.ts`, so the structure is testable without rendering it.
 *
 * The live project appears as a synthetic node hanging off the snapshot it
 * descends from. "You are here" is the question the picker exists to answer,
 * and a tree without it is just a list of names.
 */
import type { SnapshotSummary } from '@sudobility/music_types';

export const LIVE_NODE_ID = '__live__';

export type TreeNode = {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  depth: number;
  lane: number;
  isLive: boolean;
};

export function snapshotTree(
  snapshots: readonly SnapshotSummary[],
  liveParentId: string | null
): TreeNode[] {
  const byId = new Map(snapshots.map(s => [s.id, s]));

  /** Generations from the root. An orphan counts as a root rather than vanishing. */
  const depthOf = (id: string, seen = new Set<string>()): number => {
    const snapshot = byId.get(id);
    if (!snapshot || snapshot.parentId === null || seen.has(id)) return 0;
    if (!byId.has(snapshot.parentId)) return 0;
    seen.add(id);
    return depthOf(snapshot.parentId, seen) + 1;
  };

  const ordered = [...snapshots].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  const laneAt = new Map<number, number>();
  const nextLane = (depth: number): number => {
    const lane = laneAt.get(depth) ?? 0;
    laneAt.set(depth, lane + 1);
    return lane;
  };

  const nodes: TreeNode[] = ordered.map(snapshot => {
    const depth = depthOf(snapshot.id);
    return {
      id: snapshot.id,
      parentId: snapshot.parentId,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      depth,
      lane: nextLane(depth),
      isLive: false,
    };
  });

  const liveDepth =
    liveParentId && byId.has(liveParentId) ? depthOf(liveParentId) + 1 : 0;
  nodes.push({
    id: LIVE_NODE_ID,
    parentId: liveParentId,
    name: 'Current work',
    createdAt: new Date(0).toISOString(),
    depth: liveDepth,
    lane: nextLane(liveDepth),
    isLive: true,
  });

  return nodes;
}
