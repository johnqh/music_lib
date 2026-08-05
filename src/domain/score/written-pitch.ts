/**
 * Written pitch: what each player reads, as against what the score sounds.
 *
 * The model stores **sounding** pitch, and playback, MIDI export and any
 * comparison between tracks depend on that. This module is the lens: one way
 * for display, the other way for a pitch the user has just entered.
 *
 * **Stored notes are never round-tripped through it.** Measured over 1323
 * combinations of pitch, key and transposition, sounding -> written ->
 * sounding changes the pitch 0 times and the spelling 567 — so a deliberately
 * spelled C# would become Db the first time somebody toggled the view twice.
 */
import { gmWrittenTransposition } from '../instruments/gm-transposition.js';
import { transposeKeySignature, transposePitch } from '../pitch/transpose.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { KeySignature, Measure, MusicalEvent, Pitch, Score } from '@sudobility/music_types';

/** `events` with every pitch moved by `semitones`, respelled in `keySignature`. */
export function transposeEvents(
  events: readonly MusicalEvent[],
  semitones: number,
  keySignature: KeySignature,
): MusicalEvent[] {
  return events.map((event) =>
    isNoteEvent(event)
      ? { ...event, pitch: transposePitch(event.pitch, semitones, keySignature) }
      : event,
  );
}

/** `measure` with its key, every pitch, and any cue moved by `semitones`. */
export function transposeMeasure(measure: Measure, semitones: number): Measure {
  // The key first: every pitch is then respelled *in the new key*, which is
  // what makes a B♭ part in concert C spell F♯ rather than G♭. Both are the
  // same sound; only one is correct notation.
  const keySignature = transposeKeySignature(measure.keySignature, semitones);

  const transposed: Measure = {
    ...measure,
    keySignature,
    voices: measure.voices.map((voice) => ({
      ...voice,
      events: transposeEvents(voice.events, semitones, keySignature),
    })),
  };

  // The cue transposes too, or a flute cue inside a clarinet part reads a tone
  // wrong against everything around it. Rebuilt rather than spread so a
  // measure with no cue does not gain an explicit `cue: undefined`.
  return measure.cue === undefined
    ? transposed
    : {
        ...transposed,
        cue: {
          ...measure.cue,
          events: transposeEvents(measure.cue.events, semitones, keySignature),
        },
      };
}

/**
 * `score` with every track written as its own player reads it.
 *
 * The whole-score sibling of `extractPart`'s per-track transposition: each
 * track moves by its own interval, with its own key signature, so a mixed
 * ensemble shows every staff as its player reads it.
 *
 * Returns the **identical object** when nothing transposes. `computeLayout` is
 * cached by score identity, so a fresh object per render would re-format every
 * VexFlow object on every frame — the exact cost the playback work avoids.
 */
export function writtenScore(score: Score): Score {
  if (!score.tracks.some((track) => gmWrittenTransposition(track.midiProgram) !== 0)) {
    return score;
  }

  return {
    ...score,
    tracks: score.tracks.map((track) => {
      const semitones = gmWrittenTransposition(track.midiProgram);
      return semitones === 0
        ? track
        : { ...track, measures: track.measures.map((m) => transposeMeasure(m, semitones)) };
    }),
  };
}

/**
 * The sounding pitch a player on `midiProgram` produces when reading `written`.
 *
 * The input half of the lens, applied **once**, at the moment a pitch is
 * entered. `soundingKey` is the stored measure's key, so the result is
 * respelled into the score's own key rather than the reader's.
 */
export function soundingPitch(
  written: Pitch,
  midiProgram: number,
  soundingKey: KeySignature,
): Pitch {
  const semitones = gmWrittenTransposition(midiProgram);
  return semitones === 0 ? written : transposePitch(written, -semitones, soundingKey);
}
