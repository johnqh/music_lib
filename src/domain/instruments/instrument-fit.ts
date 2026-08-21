/**
 * Moving a track's music into a new instrument's compass.
 *
 * Changing the instrument on a track that already has notes is not just a
 * relabelling: a bass line handed to a piccolo sits entirely below what a
 * piccolo can play, and the result is a part that renders but cannot sound.
 * So the notes come with it — shifted by whole **octaves** where that is
 * enough, because an octave keeps the pitch class and a bassline still reads
 * as that bassline. Only when no octave shift fits does it fall back to the
 * smallest chromatic shift that does.
 *
 * A part wider than the instrument's own compass cannot be fitted at all, and
 * that answer is returned rather than approximated — the caller decides what
 * to say about it. Nothing here knows any user-facing words.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type { Score, Track, UUID } from '@sudobility/music_types';
import { transformCommand } from '../commands/snapshot.js';
import { withTracks } from '../commands/reflow.js';
import { findTrack } from '../score/queries.js';
import { pitchToMidi } from '../pitch/pitch.js';
import { transposePitch } from '../pitch/transpose.js';
import type { ScoreCommand } from '../commands/types.js';
import { gmInstrumentRange, type MidiRange } from './gm-range.js';

/** The instrument fields that move together — the name is stored, so it must not drift from the program. */
export type InstrumentPatch = { midiProgram: number; instrumentName: string };

function closestToZero(min: number, max: number): number {
  if (min <= 0 && max >= 0) return 0;
  return min > 0 ? min : max;
}

/**
 * The semitone shift that brings every pitch in `midis` inside `range`, or
 * `null` if the span is simply too wide to fit.
 *
 * `0` when it already fits, so a caller can tell "no move needed" from
 * "cannot be done" — the two are very different answers.
 */
export function shiftToFitRange(
  midis: number[],
  range: MidiRange
): number | null {
  if (midis.length === 0) return 0;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const midi of midis) {
    min = Math.min(min, midi);
    max = Math.max(max, midi);
  }
  if (min >= range.min && max <= range.max) return 0;
  if (max - min > range.max - range.min) return null;

  // Octaves first, and the one closest to no move at all: transposing by an
  // octave preserves the pitch class, so the part still reads the same.
  const minOctaves = Math.ceil((range.min - min) / 12);
  const maxOctaves = Math.floor((range.max - max) / 12);
  if (minOctaves <= maxOctaves)
    return closestToZero(minOctaves, maxOctaves) * 12;

  const minSemitones = range.min - min;
  const maxSemitones = range.max - max;
  return minSemitones <= maxSemitones
    ? closestToZero(minSemitones, maxSemitones)
    : null;
}

function noteMidis(track: Track): number[] {
  const midis: number[] = [];
  for (const measure of track.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (isNoteEvent(event)) midis.push(pitchToMidi(event.pitch));
      }
    }
  }
  return midis;
}

/**
 * The shift `trackId`'s notes need to fit `midiProgram`, or `null` if they
 * cannot. Ask this *before* dispatching, so a change that would be refused can
 * be reported rather than silently doing nothing.
 */
export function fitShiftForInstrument(
  score: Score,
  trackId: UUID,
  midiProgram: number
): number | null {
  const track = findTrack(score, trackId);
  return track
    ? shiftToFitRange(noteMidis(track), gmInstrumentRange(midiProgram))
    : null;
}

/**
 * Sets the instrument and moves the existing notes to suit it, as one command
 * — so a single undo puts both back.
 *
 * A part that cannot be fitted leaves the score untouched; pair this with
 * `fitShiftForInstrument` if you need to tell the user why nothing happened.
 */
export function changeInstrumentCommand(
  trackId: UUID,
  patch: InstrumentPatch,
  label: string
): ScoreCommand {
  return transformCommand(label, score => {
    const shift = fitShiftForInstrument(score, trackId, patch.midiProgram);
    if (shift === null) return score;

    const tracks = score.tracks.map(candidate => {
      if (candidate.id !== trackId) return candidate;

      const measures =
        shift === 0
          ? candidate.measures
          : candidate.measures.map(measure => ({
              ...measure,
              voices: measure.voices.map(voice => ({
                ...voice,
                events: voice.events.map(event =>
                  isNoteEvent(event)
                    ? {
                        ...event,
                        pitch: transposePitch(
                          event.pitch,
                          shift,
                          measure.keySignature
                        ),
                      }
                    : event
                ),
              })),
            }));

      return { ...candidate, ...patch, measures };
    });

    return withTracks(score, tracks);
  });
}
