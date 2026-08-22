/**
 * Typing music.
 *
 * The editor could enter notes three ways — the toolbar's Insert button, the
 * piano keyboard, and AI generation — and none of them was fast. Insert writes
 * C4 and leaves you transposing with the arrow keys; the piano keyboard is good
 * but needs the panel open and a mouse; generation is not editing. Writing a
 * bar meant reaching for the pointer on every single note.
 *
 * This is the fourth way, and the one every other notation editor has: letters
 * for pitch, digits for duration. It adds no new capability to the model — it
 * reaches `insertNoteAtCaret` and `snapGrid` exactly as the toolbar does — it
 * just removes the pointer from the loop.
 *
 * The conventions are borrowed rather than invented, because they are the ones
 * a musician arriving from MuseScore, Sibelius or Dorico already has in their
 * fingers.
 */
import type {
  DurationName,
  Pitch,
  PitchStep,
  Score,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { findTrack, pitchToMidi, selectActiveTrackId } from '../../index.js';
import type { createAppStore } from '../../store/useAppStore.js';

/**
 * The store these read from.
 *
 * Defined structurally rather than imported from the app: this module moved
 * out of music_app precisely because it is not UI, and it would be a poor
 * trade to leave a type dependency pointing back the other way.
 */
type EditorStoreApi = ReturnType<typeof createAppStore>;
import { withBase } from '@sudobility/music_types';
import type { BaseDuration } from '@sudobility/music_types';

/** Digit to note value, the numbering every notation editor uses. */
export const DURATION_DIGITS: Record<string, BaseDuration> = {
  '1': 'whole',
  '2': 'half',
  '3': 'quarter',
  '4': 'eighth',
  '5': 'sixteenth',
  '6': 'thirtysecond',
};

const PITCH_LETTERS = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

/** Whether `key` names a pitch. Case-insensitive: shift is not a modifier here. */
export function isPitchLetter(key: string): boolean {
  return PITCH_LETTERS.has(key.toLowerCase());
}

/**
 * The octave that puts `step` closest to `reference`.
 *
 * Typing "C" after a B should give the C a semitone above, not the C an octave
 * and a seventh below — the note you mean is almost always the nearest one.
 * This is what every notation editor does, and without it letter entry is
 * unusable for anything but a scale starting on C4.
 *
 * Ties go upward: from a reference of F, the tritone B is written above rather
 * than below, which matches how a melody is usually read.
 */
export function nearestOctaveFor(step: PitchStep, reference: Pitch): number {
  const referenceMidi = pitchToMidi(reference);
  let best = reference.octave;
  let bestDistance = Number.POSITIVE_INFINITY;

  // Only the three octaves around the reference can ever win.
  for (const octave of [
    reference.octave - 1,
    reference.octave,
    reference.octave + 1,
  ]) {
    const distance = Math.abs(
      pitchToMidi({ step, accidental: 0, octave }) - referenceMidi
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = octave;
    }
  }
  return best;
}

/**
 * The note a new letter should be measured against: the last note before the
 * caret on the active track, or middle C when the track is empty.
 *
 * Deliberately the note *before the caret* rather than the selected one. Entry
 * runs left to right and the caret is where the next note goes, so the sensible
 * reference is what a player would have just played.
 */
export function entryReferencePitch(store: EditorStoreApi): Pitch {
  const state = store.getState();
  const score: Score | null = state.score;
  const trackId = selectActiveTrackId(state);
  const fallback: Pitch = { step: 'C', accidental: 0, octave: 4 };
  if (!score || !trackId) return fallback;

  const track = findTrack(score, trackId);
  if (!track) return fallback;

  let best: { tick: number; pitch: Pitch } | null = null;
  for (const measure of track.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (!isNoteEvent(event)) continue;
        if (event.startTick > state.caretTick) continue;
        if (!best || event.startTick >= best.tick)
          best = { tick: event.startTick, pitch: event.pitch };
      }
    }
  }
  return best?.pitch ?? fallback;
}

/** The pitch a typed letter means, given where entry has got to. */
export function pitchForLetter(store: EditorStoreApi, key: string): Pitch {
  const step = key.toUpperCase() as PitchStep;
  const reference = entryReferencePitch(store);
  return { step, accidental: 0, octave: nearestOctaveFor(step, reference) };
}

/**
 * The duration a digit selects, preserving the dot or triplet already chosen.
 *
 * Pressing 3 while Dotted is lit gives a dotted quarter, the same way the
 * toolbar's own duration buttons do — the modifier is a mode, not part of the
 * value.
 */
export function durationForDigit(
  digit: string,
  current: DurationName
): DurationName | null {
  const base = DURATION_DIGITS[digit];
  return base ? withBase(current, base) : null;
}
