/**
 * Instrument lookups that take a **track**, not a program number.
 *
 * `Track.midiProgram` means one of two different things depending on the
 * track's clef: a General MIDI instrument on a pitched track, a drum kit on a
 * percussion one. Every table in this folder is keyed by program, so reading
 * one without knowing the clef silently answers for the wrong thing — and the
 * wrong answers were not obviously wrong, which is why they shipped:
 *
 * - Brush is kit 40, and program 40 is Violin, so `gmMaxPolyphony` capped a
 *   drum track at two simultaneous notes and the toolbar refused a three-piece
 *   crash-snare-kick hit.
 * - Electronic and TR-808 are kits 24 and 25, and programs 24-25 are guitars,
 *   which are written an octave above where they sound — so in written mode a
 *   TR-808 part was drawn an octave off the staff position for its own drums.
 * - Every kit is some melodic instrument's range, so the on-screen keyboard
 *   offered keys that could not sound a drum and hid the ones that could.
 *
 * These wrappers are the single place that distinction is encoded. Call them
 * instead of the program-keyed tables anywhere a `Track` is in hand.
 */
import type { Score, Track } from '@sudobility/music_types';
import { gmInstrumentRange, type MidiRange } from './gm-range.js';
import { gmMaxPolyphony, UNLIMITED_POLYPHONY } from './gm-polyphony.js';
import { gmWrittenTransposition } from './gm-transposition.js';
import { gmKit, gmKitAt } from './gm-kit.js';
import { GM_PERCUSSION_RANGE } from './gm-percussion.js';
import { gmInstrumentIcon, gmKitIcon } from './gm-icon.js';
import type { InstrumentIconArt } from './icon-art.js';
import { gmInstrument } from './gm.js';

/** Whether `track`'s `midiProgram` addresses a drum kit rather than an instrument. */
export function isPercussionTrack(track: Pick<Track, 'clef'>): boolean {
  return track.clef === 'percussion';
}

/**
 * The notes worth showing for `track` — General MIDI's drum range on a
 * percussion track, the instrument's compass otherwise.
 */
export function trackKeyboardRange(
  track: Pick<Track, 'clef' | 'midiProgram'>
): MidiRange {
  if (isPercussionTrack(track)) return { ...GM_PERCUSSION_RANGE };
  return gmInstrumentRange(track.midiProgram);
}

/**
 * How many notes `track` can sound at once.
 *
 * Unlimited on a drum track: the limit exists to stop a part being written that
 * nobody could play, and a kit is played with two hands and two feet across
 * pieces that are all struck separately. Nothing about a kit address says
 * otherwise.
 */
export function trackMaxPolyphony(
  track: Pick<Track, 'clef' | 'midiProgram'>
): number {
  if (isPercussionTrack(track)) return UNLIMITED_POLYPHONY;
  return gmMaxPolyphony(track.midiProgram);
}

/**
 * Semitones between `track`'s sounding and written pitch.
 *
 * Always zero on a drum track. A percussion staff's positions name drums, so
 * transposing one does not move a part into a reader's key — it renames every
 * drum in it.
 */
export function trackWrittenTransposition(
  track: Pick<Track, 'clef' | 'midiProgram'>
): number {
  if (isPercussionTrack(track)) return 0;
  return gmWrittenTransposition(track.midiProgram);
}

/**
 * `track`'s program, corrected to something its clef can actually mean.
 *
 * On a percussion track that is the kit whose region the address falls in; a
 * MIDI file is free to set program 45 on channel 10, and the kit that resolves
 * to is Brush. Off a percussion track the program is already an instrument and
 * is returned untouched.
 */
export function trackProgramForClef(
  track: Pick<Track, 'clef' | 'midiProgram'>
): number {
  return isPercussionTrack(track)
    ? gmKitAt(track.midiProgram).program
    : track.midiProgram;
}

/** The icon for `track` — a kit on a percussion track, its instrument's art otherwise. */
export function trackInstrumentIcon(
  track: Pick<Track, 'clef' | 'midiProgram'>
): InstrumentIconArt {
  return isPercussionTrack(track)
    ? gmKitIcon()
    : gmInstrumentIcon(track.midiProgram);
}

/** What to call `track`'s sound: its kit's name on a percussion track, its instrument's otherwise. */
export function trackInstrumentLabel(
  track: Pick<Track, 'clef' | 'midiProgram'>
): string {
  if (isPercussionTrack(track)) return gmKitAt(track.midiProgram).name;
  return gmInstrument(track.midiProgram)?.name ?? 'Instrument';
}

/**
 * `score` with every percussion track's program resolved to a real kit.
 *
 * A drum track can arrive holding an address no kit sits at: a MIDI file sets
 * whatever program it likes on channel 10, and nothing before this treated that
 * number as a kit at all. The picker would then have to show something the
 * score does not say, so the score is corrected instead of the display fudged.
 *
 * A track already on a kit address is returned untouched — including its
 * `instrumentName`, which is the user's description of a sound that is not
 * changing. Only a track being corrected has its name rewritten, because the
 * old one described a different kit.
 *
 * Returns the **identical object** when nothing needs correcting, which is the
 * usual case: `computeLayout` is cached by score identity, and a fresh object
 * on every load would also read as a change to the autosaver.
 */
export function scoreWithResolvedKits(score: Score): Score {
  const needsWork = score.tracks.some(
    track => isPercussionTrack(track) && gmKit(track.midiProgram) === null
  );
  if (!needsWork) return score;

  return {
    ...score,
    tracks: score.tracks.map(track => {
      if (!isPercussionTrack(track) || gmKit(track.midiProgram) !== null)
        return track;
      const kit = gmKitAt(track.midiProgram);
      return { ...track, midiProgram: kit.program, instrumentName: kit.name };
    }),
  };
}
