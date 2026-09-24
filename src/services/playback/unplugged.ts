/**
 * Unplugged mode: where each instrument stands on a stage, and what that
 * position means for volume and pan.
 *
 * `music_types` holds the shape (`UnpluggedListener`, `UnpluggedPoint`,
 * `UnpluggedArrangement`, and the commands that write them onto a `Score`).
 * This file holds the policy over that shape — what the default half-circle
 * looks like, and the formula that turns a position into a mix — because
 * both are decisions this product made, not facts about music. Shared by
 * both apps so the two Unplugged tabs cannot compute a different volume for
 * the same arrangement.
 *
 * The whole arrangement is *computed*, never required to be stored:
 * `Score.unplugged` is absent until a reader first drags something, and
 * `effectiveUnpluggedArrangement` fills in a default half-circle position
 * for the listener and for any track — placed or not, old or newly added —
 * that has none. A caller never needs to check whether the arrangement
 * exists before asking where something is.
 */
import { clampPan, clampVolume } from '@sudobility/music_types';
import type {
  Score,
  UnpluggedListener,
  UnpluggedPoint,
  UUID,
} from '@sudobility/music_types';

/**
 * The default half-circle's radius, in the same arbitrary units as every
 * `UnpluggedPoint`. Also the reference distance the volume falloff below is
 * measured against, so widening the default stage widens how far a dragged
 * instrument can travel before it reaches the quiet floor.
 */
export const UNPLUGGED_RADIUS = 5;

/** Where the listener starts: the centre of the half-circle, facing straight into it. */
export function defaultUnpluggedListener(): UnpluggedListener {
  return { x: 0, z: 0, facingDeg: 0 };
}

/**
 * The default half-circle slot for every track, in roster order.
 *
 * Spread evenly across 180°, from dead left to dead right of the listener's
 * starting facing — a single track goes dead ahead rather than dividing by
 * zero. This is also what a track that has never been dragged falls back
 * to, so adding a track to the roster gives it a sensible slot for free.
 */
export function defaultUnpluggedTrackPositions(
  trackIds: readonly UUID[],
  radius = UNPLUGGED_RADIUS
): Readonly<Record<UUID, UnpluggedPoint>> {
  const count = trackIds.length;
  const positions: Record<UUID, UnpluggedPoint> = {};
  trackIds.forEach((id, index) => {
    const angleDeg = count <= 1 ? 0 : -90 + (180 * index) / (count - 1);
    const angleRad = (angleDeg * Math.PI) / 180;
    positions[id] = {
      x: radius * Math.sin(angleRad),
      z: radius * Math.cos(angleRad),
    };
  });
  return positions;
}

/** The listener and every track's position, defaults filled in for anything not yet placed. */
export type EffectiveUnpluggedArrangement = {
  listener: UnpluggedListener;
  tracks: Readonly<Record<UUID, UnpluggedPoint>>;
};

/**
 * The arrangement a reader actually sees: `score.unplugged`'s saved
 * positions layered over the computed half-circle default, so every current
 * track has a position and the listener always has one, whether or not the
 * project has ever been touched.
 */
export function effectiveUnpluggedArrangement(
  score: Pick<Score, 'tracks' | 'unplugged'>
): EffectiveUnpluggedArrangement {
  const trackIds = score.tracks.map(track => track.id);
  const defaults = defaultUnpluggedTrackPositions(trackIds);
  return {
    listener: score.unplugged?.listener ?? defaultUnpluggedListener(),
    tracks: { ...defaults, ...(score.unplugged?.tracks ?? {}) },
  };
}

export type UnpluggedMix = { volume: number; pan: number };

/**
 * How far past the radius a track has to be before its volume stops
 * falling any further.
 */
const FALLOFF_RANGE = 2;

/** The volume floor a track reaches once it is `FALLOFF_RANGE` radii away, however much further it goes. */
const DISTANCE_FLOOR = 0.25;

/** The volume factor directly behind the listener, at any distance — see `frontBackFactor`. */
const BEHIND_FACTOR = 0.5;

/**
 * 1.0 at zero distance, falling in a straight line to `DISTANCE_FLOOR` at
 * `FALLOFF_RANGE` radii out, and no further beyond that.
 */
function distanceFalloff(distance: number, radius: number): number {
  if (distance <= 0) return 1;
  const maxDistance = radius * FALLOFF_RANGE;
  if (distance >= maxDistance) return DISTANCE_FLOOR;
  return 1 - (1 - DISTANCE_FLOOR) * (distance / maxDistance);
}

/**
 * 1.0 dead ahead of the listener's facing, `BEHIND_FACTOR` directly behind,
 * and a cosine curve between the two — smooth rather than a hard cutoff at
 * the listener's shoulders, so turning slowly fades a part out rather than
 * snapping it.
 */
function frontBackFactor(relativeAngleRad: number): number {
  const midpoint = (1 + BEHIND_FACTOR) / 2;
  const swing = (1 - BEHIND_FACTOR) / 2;
  return midpoint + swing * Math.cos(relativeAngleRad);
}

/**
 * The volume and pan a track at `point` should play at, for a listener
 * standing at `listener` facing `listener.facingDeg`.
 *
 * The bearing to `point` is measured clockwise from the listener's `+z`
 * (their default forward), matching `facingDeg`'s own convention — so
 * turning the listener's facing rotates every track's apparent bearing by
 * the same amount, which is what makes "what was on my left is now ahead of
 * me" fall out of the arithmetic rather than needing to be special-cased.
 *
 * `pan` is a standard equal-power stereo pan by that relative angle: `sin`
 * of it, clamped to [-1, 1] — full right at 90° to the right, full left at
 * 90° to the left, centred both dead ahead and directly behind. `volume` is
 * the distance falloff times the front/back factor — two independent
 * multipliers, so a distant instrument directly behind is quieter for both
 * reasons at once rather than either one overriding the other.
 */
export function unpluggedMixFor(
  listener: UnpluggedListener,
  point: UnpluggedPoint,
  radius = UNPLUGGED_RADIUS
): UnpluggedMix {
  const dx = point.x - listener.x;
  const dz = point.z - listener.z;
  const distance = Math.hypot(dx, dz);
  const bearingDeg = (Math.atan2(dx, dz) * 180) / Math.PI;
  const relativeDeg =
    ((((bearingDeg - listener.facingDeg + 180) % 360) + 360) % 360) - 180;
  const relativeRad = (relativeDeg * Math.PI) / 180;

  return {
    volume: clampVolume(
      distanceFalloff(distance, radius) * frontBackFactor(relativeRad)
    ),
    pan: clampPan(Math.sin(relativeRad)),
  };
}

/** Every track's `{volume, pan}` for the current arrangement, keyed by track id. */
export function unpluggedMixes(
  score: Pick<Score, 'tracks' | 'unplugged'>,
  radius = UNPLUGGED_RADIUS
): Readonly<Record<UUID, UnpluggedMix>> {
  const arrangement = effectiveUnpluggedArrangement(score);
  const mixes: Record<UUID, UnpluggedMix> = {};
  for (const track of score.tracks) {
    const point = arrangement.tracks[track.id];
    if (point)
      mixes[track.id] = unpluggedMixFor(arrangement.listener, point, radius);
  }
  return mixes;
}
