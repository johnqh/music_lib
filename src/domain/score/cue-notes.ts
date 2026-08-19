/**
 * Where cue notes go, and whose notes they are.
 *
 * **Derived per part, from the rest of the score** — the opposite of rehearsal
 * marks. A mark must mean the same bar to everybody; a cue is for one player's
 * entry, drawn from the tracks they are about to come in against.
 *
 * Print-only: a stored score carries none, and the whole-score print gets none
 * either, because a conductor is already looking at every part.
 */
import { isNoteEvent } from '@sudobility/music_types';
import { isSilentMeasure } from './collapse-rests.js';
import type {
  Measure,
  MeasureCue,
  MusicalEvent,
  Score,
  Track,
} from '@sudobility/music_types';

/**
 * Shortest rest that earns a cue.
 *
 * Below this nobody is lost, and the cue costs a bar that would otherwise be
 * counted inside a multi-measure rest. A chosen number, not a derived one.
 */
export const MIN_REST_FOR_CUE = 8;

/** How many notes sound in `measure`, across every voice. */
function noteCount(measure: Measure): number {
  return measure.voices.reduce(
    (total, voice) => total + voice.events.filter(isNoteEvent).length,
    0
  );
}

/**
 * The events of `measure`'s busiest voice.
 *
 * One voice, not all of them: a cue is a landmark, and stacking a piano's two
 * hands into one small-print bar makes it harder to read, not more informative.
 */
function busiestVoiceEvents(measure: Measure): MusicalEvent[] {
  let best: MusicalEvent[] = [];
  let bestCount = 0;
  for (const voice of measure.voices) {
    const count = voice.events.filter(isNoteEvent).length;
    if (count > bestCount) {
      best = voice.events;
      bestCount = count;
    }
  }
  return best;
}

/** The other track with the most notes in bar `index`, or undefined if none plays. */
function busiestOtherTrack(
  others: readonly Track[],
  index: number
): Track | undefined {
  let best: Track | undefined;
  let bestCount = 0;
  for (const track of others) {
    const measure = track.measures[index];
    const count = measure ? noteCount(measure) : 0;
    if (count > bestCount) {
      best = track;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Cues for `trackId`'s part, keyed by measure index.
 *
 * One bar, on the last bar of any rest of `MIN_REST_FOR_CUE` or more that is
 * followed by an entry. A rest running to the end of the piece gets none:
 * there is nothing to prepare for.
 */
export function measureCues(
  score: Score,
  trackId: string
): Map<number, MeasureCue> {
  const cues = new Map<number, MeasureCue>();
  const track = score.tracks.find(t => t.id === trackId);
  if (!track) return cues;

  const others = score.tracks.filter(t => t.id !== trackId);

  let index = 0;
  while (index < track.measures.length) {
    if (!isSilentMeasure(track.measures[index])) {
      index += 1;
      continue;
    }

    let end = index;
    while (end < track.measures.length && isSilentMeasure(track.measures[end]))
      end += 1;

    const entersAfter = end < track.measures.length;
    if (end - index >= MIN_REST_FOR_CUE && entersAfter) {
      const cueIndex = end - 1;
      const source = busiestOtherTrack(others, cueIndex);
      if (source) {
        cues.set(cueIndex, {
          label: source.name,
          events: busiestVoiceEvents(source.measures[cueIndex]),
        });
      }
    }

    index = end;
  }

  return cues;
}

/**
 * `measures` with each cue written onto the measure carrying that **index**.
 *
 * Keyed by `measure.index` for the same reason marks are: a part's measures
 * may already have been thinned, so array position means nothing.
 */
export function applyCues(
  measures: readonly Measure[],
  cues: ReadonlyMap<number, MeasureCue>
): Measure[] {
  return measures.map(measure => {
    const cue = cues.get(measure.index);
    return cue === undefined ? measure : { ...measure, cue };
  });
}
