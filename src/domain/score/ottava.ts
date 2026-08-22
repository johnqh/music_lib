/**
 * The octave brackets, as a display lens.
 *
 * `8va` means "these notes were written an octave lower to keep them on the
 * stave — play them where the bracket says". The model stores **sounding**
 * pitch, so the bracket is what moves the noteheads, not the sound: this walks
 * a score and shifts every note inside a span to where it should be *drawn*.
 *
 * A lens over the whole score rather than a shift inside the renderer, for the
 * reason `writtenScore` is one: the layout and everything measured from it see
 * the same score, so the drawn note and its staff position agree by
 * construction rather than by two matched calculations.
 *
 * Returns the **identical object** when no bracket exists, so `computeLayout`'s
 * identity cache is untouched by a score that has none — which is almost every
 * score.
 *
 * **Known limitation**, shared with `writtenScore`: clicking to place a note
 * *inside* a bracket writes the drawn pitch as the sounding one, because note
 * entry has no inverse for the display lens. That gap predates this and is not
 * specific to ottava.
 */
import type { NoteEvent, Ottava, Score } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';

/** How many octaves, and which way, a bracket displaces what is written. */
const OTTAVA_OCTAVES: Record<Ottava, number> = {
  '8va': 1,
  '8vb': -1,
  '15ma': 2,
  '15mb': -2,
};

/** The octave displacement `ottava` asks for, in octaves. */
export function ottavaOctaves(ottava: Ottava): number {
  return OTTAVA_OCTAVES[ottava];
}

/** Whether any note in `score` opens a bracket. */
export function hasOttava(score: Score): boolean {
  return score.tracks.some(track =>
    track.measures.some(measure =>
      measure.voices.some(voice =>
        voice.events.some(e => isNoteEvent(e) && e.ottavaStart)
      )
    )
  );
}

/**
 * `score` with every note inside a bracket moved to where it is written.
 *
 * The shift is the *opposite* of the bracket's displacement: `8va` says the
 * player sounds an octave above the page, so the page shows an octave below
 * the stored sound.
 *
 * Spans are read per voice and in tick order — a bracket opens on one note and
 * closes on a later one in the same line, exactly like a slur — and an
 * unclosed opening runs to the end of its voice rather than being dropped,
 * which is what a reader does with a bracket whose end is missing.
 */
export function ottavaScore(score: Score): Score {
  if (!hasOttava(score)) return score;

  const shifts = octaveShifts(score);
  if (shifts.size === 0) return score;

  return {
    ...score,
    tracks: score.tracks.map(track => ({
      ...track,
      measures: track.measures.map(measure => ({
        ...measure,
        voices: measure.voices.map(voice => ({
          ...voice,
          events: voice.events.map(event => {
            const octaves = isNoteEvent(event)
              ? shifts.get(event.id)
              : undefined;
            if (octaves === undefined) return event;
            const note = event as NoteEvent;
            return {
              ...note,
              pitch: { ...note.pitch, octave: note.pitch.octave - octaves },
            };
          }),
        })),
      })),
    })),
  };
}

/**
 * Every note inside a bracket, and how many octaves it is displaced by.
 *
 * Walked per **voice ordinal across measures**, not per measure: a bracket
 * opens on one note and closes on a later one, and the later one is usually in
 * a different bar. The ordinal stands in for "the same line" from bar to bar,
 * which is the convention `trackVoiceChannels` and `joinTiedNotes` already use.
 */
function octaveShifts(score: Score): Map<string, number> {
  const shifts = new Map<string, number>();

  for (const track of score.tracks) {
    const voiceCount = track.measures.reduce(
      (max, m) => Math.max(max, m.voices.length),
      0
    );

    for (let ordinal = 0; ordinal < voiceCount; ordinal += 1) {
      const line: NoteEvent[] = [];
      for (const measure of track.measures) {
        const voice = measure.voices[ordinal];
        if (!voice) continue;
        for (const event of voice.events) {
          if (isNoteEvent(event)) line.push(event);
        }
      }
      line.sort((a, b) => a.startTick - b.startTick);

      let open: Ottava | null = null;
      for (const note of line) {
        if (!open && note.ottavaStart) open = note.ottavaStart;
        if (open) shifts.set(note.id, OTTAVA_OCTAVES[open]);
        // Closed *after* shifting: the closing note is inside its own bracket.
        if (open && note.ottavaStop) open = null;
      }
    }
  }

  return shifts;
}
