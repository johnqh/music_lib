/**
 * Making a fermata audible, as a local slowing rather than a longer note.
 *
 * A pause holds a note and delays everything after it. The obvious model —
 * stretch the note and shift the rest — is the wrong one here, because the
 * score tick *is* the playback tick: the caret, the following-scroll, "play
 * from here" and the position scrubber all rest on that identity, and moving
 * notes in time would break every one of them.
 *
 * A tempo dip changes none of it. The notes keep their written ticks; the
 * ticks simply take longer to elapse across the held note, which is what a
 * fermata means to a player anyway — the beat stretches, the notation does
 * not. **And it is the reason the caret needed no work at all**: it
 * dead-reckons between position reports through a `TempoMap`, so a map that
 * slows down slows the caret down with it. Building the caret's map from
 * anything else would make it glide past the pause and snap back, which is
 * exactly the class of bug its interpolation exists to avoid.
 *
 * So this is the single derivation, and `playbackPlan`, `renderEvents` and the
 * caret all read it. Live playback, the exported audio file and the thing on
 * screen therefore cannot disagree about how long a pause lasts.
 *
 * A score with no fermata returns its own `tempoMap` array **unchanged, by
 * identity**, so nothing about an unmarked score's playback is even
 * recomputed.
 */
import type { NoteEvent, Score, TempoEvent } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { createId } from './ids.js';
import { TempoMap } from '../time/tempo-map.js';

/**
 * How much longer a held note lasts than its written value.
 *
 * Two is the conventional reading and the one most notation software uses. It
 * is deliberately not configurable per fermata: how long to hold is the
 * performer's judgement, and a score that recorded a number would be claiming
 * an authority the marking does not have.
 */
const HOLD_FACTOR = 2;

/** A span of written time that is held, in score ticks. */
type HoldSpan = { start: number; end: number };

/**
 * Every span a fermata holds, merged into non-overlapping runs.
 *
 * A fermata is observed by the whole ensemble at once, so overlapping spans
 * are one pause. Merging is not about compounding — each span reads its
 * reduced tempo from the *original* map, so two identical spans produce the
 * same slowing twice and cancel out harmlessly. It is about spans of
 * **different lengths**: a quarter note held in one part and a whole note held
 * in another both start the pause, but without merging the quarter's restoring
 * event lands in the middle of the whole note's hold and cuts it short. The
 * players wait for each other; the pause ends when the longest one ends.
 */
function holdSpans(score: Score): HoldSpan[] {
  const spans: HoldSpan[] = [];
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (!isNoteEvent(event)) continue;
          const note = event as NoteEvent;
          if (!note.fermata) continue;
          spans.push({
            start: note.startTick,
            end: note.startTick + note.durationTicks,
          });
        }
      }
    }
  }
  if (spans.length === 0) return spans;

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: HoldSpan[] = [spans[0]];
  for (const span of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/**
 * `score.tempoMap` with a slowing written across every held span.
 *
 * Two events per span: one entering it at the reduced tempo, one leaving it
 * that restores whatever was in force at that point. The restoring event reads
 * the tempo from the *original* map, so a tempo change that happens to fall
 * inside a pause is still honoured on the way out rather than being flattened
 * to whatever the pause started at.
 *
 * Returns the score's own array by identity when nothing is held.
 */
export function fermataTempoMap(score: Score): TempoEvent[] {
  const spans = holdSpans(score);
  if (spans.length === 0) return score.tempoMap;

  const source = new TempoMap(score.tempoMap, score.ppq);
  const added: TempoEvent[] = [];

  for (const span of spans) {
    if (span.end <= span.start) continue;
    added.push({
      id: createId(),
      tick: span.start,
      bpm: source.bpmAt(span.start) / HOLD_FACTOR,
    });
    added.push({
      id: createId(),
      tick: span.end,
      bpm: source.bpmAt(span.end),
    });
  }

  // The added events win at a tick an original also sits on: a starting tempo
  // written at the same beat as a pause still has to be paused through.
  const kept = score.tempoMap.filter(
    event => !added.some(a => a.tick === event.tick)
  );
  return [...kept, ...added].sort((a, b) => a.tick - b.tick);
}
