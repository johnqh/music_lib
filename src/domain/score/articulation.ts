/**
 * What an articulation does to the sound.
 *
 * A staccato dot, an accent, a tenuto line and a marcato wedge were modelled,
 * drawn, exported and imported long before anything played them — so a passage
 * marked staccato sounded exactly as long as a legato one, and an accent was no
 * louder than the note beside it. The marking was decoration.
 *
 * This resolves it, in the same place and by the same rules as a dynamic:
 * inside `flattenScoreNotes`, the single traversal live playback and offline
 * export already share, so the two cannot disagree about how a bar is played.
 *
 * **Two axes, because that is what these four markings actually say.** Staccato
 * is about *length* and accent is about *weight*; marcato is both, and tenuto
 * is the full length it would have had anyway. So each marking resolves to a
 * length factor and a velocity offset rather than to one number.
 *
 * **It applies on top of the dynamic, never instead of it.** `effectiveVelocity`
 * has already turned the marking in force plus the note's own written deviation
 * into a velocity; the articulation is a further offset on that. This is the
 * same doctrine dynamics established — an accent inside a quiet passage stays
 * an accent, and an accent under `ff` is still louder than its neighbours
 * rather than being flattened against the ceiling by a fixed level.
 *
 * **Shortening never moves anything.** A staccato note releases early; it still
 * occupies its written length in the bar, so every following note starts
 * exactly where it did. That is what keeps this a performance detail rather
 * than an edit — and it is why the score is not rewritten to short notes plus
 * rests, which is the other way to make staccato audible and which would make
 * the marking impossible to remove.
 */
import type { Articulation } from '@sudobility/music_types';

/** How a marking is performed: a proportion of the written length, and a weight. */
export type ArticulationSound = {
  /** The fraction of its written length the note actually sounds for. */
  lengthFactor: number;
  /** Added to the velocity the dynamic and the note's own deviation produced. */
  velocityDelta: number;
};

/** An unmarked note: full length, no added weight. */
const PLAIN: ArticulationSound = { lengthFactor: 1, velocityDelta: 0 };

/**
 * The performance of each marking.
 *
 * - `staccato` — detached, at half its written length. The conventional
 *   reading, and short enough to hear as detached at any tempo.
 * - `tenuto` — held. Its length factor is 1, which is *already* the default,
 *   so the emphasis is the only audible part; see the note below.
 * - `accent` — struck harder, full length. A weight, not a shortening.
 * - `marcato` — marked: harder than an accent and somewhat detached, which is
 *   the difference between the two.
 *
 * **Tenuto is deliberately near-inaudible, and that is the honest answer.** It
 * means "hold this note its full value", and an unmarked note here is already
 * held its full value — so the alternative was to shorten *every* unmarked note
 * slightly to make room for tenuto to be longer. That would change the playback
 * of every score ever written in this app to give one rare marking something to
 * contrast against, and it would break the rule the dynamics work established:
 * an unmarked score plays exactly as it did before the feature existed.
 */
const ARTICULATION_SOUND: Record<Articulation, ArticulationSound> = {
  staccato: { lengthFactor: 0.5, velocityDelta: 0 },
  tenuto: { lengthFactor: 1, velocityDelta: 4 },
  accent: { lengthFactor: 1, velocityDelta: 20 },
  marcato: { lengthFactor: 0.8, velocityDelta: 28 },
};

/** How `articulation` is performed. An absent marking plays plain. */
export function articulationSound(
  articulation: Articulation | undefined
): ArticulationSound {
  return articulation ? ARTICULATION_SOUND[articulation] : PLAIN;
}

/**
 * The velocity `velocity` sounds at once `articulation` is applied.
 *
 * `velocity` is what the dynamic in force and the note's own written deviation
 * already produced, so this is the last step before the engine sees it.
 */
export function articulatedVelocity(
  velocity: number,
  articulation: Articulation | undefined
): number {
  const { velocityDelta } = articulationSound(articulation);
  if (velocityDelta === 0) return velocity;
  return Math.max(1, Math.min(127, velocity + velocityDelta));
}

/**
 * How long a note of `durationTicks` actually sounds under `articulation`.
 *
 * Never rounds down to nothing: a thirty-second note marked staccato at a fast
 * tempo is still a note, and a zero-length one would simply not play.
 */
export function articulatedDuration(
  durationTicks: number,
  articulation: Articulation | undefined
): number {
  const { lengthFactor } = articulationSound(articulation);
  if (lengthFactor === 1) return durationTicks;
  return Math.max(1, Math.round(durationTicks * lengthFactor));
}
