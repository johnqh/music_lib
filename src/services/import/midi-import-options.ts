/**
 * Editing the MIDI import options a wizard shows, with the field rules in one
 * place.
 *
 * `MidiImportOptions` and `defaultMidiImportOptions` live in music_codecs, which
 * decodes MIDI on both sides of the network. What a *form* may write into them
 * is a frontend question, and both apps answered it inline — differently. The
 * web wizard floored the minimum duration at 0 and the native sheet at 1 with a
 * ceiling of 480; the native sheet refused an import with no tracks and the web
 * wizard happily built an empty score; and the web wrote its split point as
 * `Number(text) || 60`, which reads a split at MIDI note 0 as falsy and quietly
 * moves it to middle C. The web's clamps are the reference, the native app's
 * empty-import refusal is kept because it is right, and the `|| 60` is gone.
 */
import type {
  MidiImportOptions,
  MidiTrackSelection,
} from '@sudobility/music_codecs';

/** The lowest and highest MIDI note numbers a split point can name. */
const MIDI_NOTE_MIN = 0;
const MIDI_NOTE_MAX = 127;

/**
 * A change to the options: any plain field, and optionally one track's row,
 * addressed by its `sourceIndex` — the track's index in the file, which is
 * what the wizard's rows are keyed by. Position in `trackSelections` is not
 * the same thing once a file has empty tracks.
 */
export type MidiImportPatch = Partial<
  Omit<
    MidiImportOptions,
    'trackSelections' | 'splitPointMidi' | 'minDurationTicks'
  >
> & {
  /**
   * The two number fields take `null` for a **cleared** field, which is what
   * `parseNumericDraft(text)` answers for empty text.
   *
   * Not `Number(text)`: that reads an emptied field as 0, so clearing the split
   * point to type a new one moved the split to the lowest note there is — the
   * same class of bug as the `|| 60` this replaces, from the other direction.
   */
  splitPointMidi?: number | null;
  minDurationTicks?: number | null;
  track?: Pick<MidiTrackSelection, 'sourceIndex'> &
    Partial<Pick<MidiTrackSelection, 'include' | 'clef'>>;
};

/**
 * The options with a patch applied, and the numeric fields made valid.
 *
 * - `splitPointMidi` is rounded and clamped to MIDI 0-127. **Zero survives**:
 *   it is a note, not an absence. `null` (a cleared field) or a value that is
 *   not a number leaves the previous split point in place rather than
 *   inventing one.
 * - `minDurationTicks` is rounded and floored at 0, and `null` (a cleared
 *   field) reads as 0 — "drop nothing", the web wizard's rule. There is no
 *   ceiling: a long minimum is a strange request, not an invalid one.
 */
export function patchMidiImportOptions(
  options: MidiImportOptions,
  patch: MidiImportPatch
): MidiImportOptions {
  const { track, splitPointMidi, minDurationTicks, ...plain } = patch;
  const fields = { splitPointMidi, minDurationTicks };
  const next: MidiImportOptions = { ...options, ...plain };

  if (fields.splitPointMidi !== undefined) {
    next.splitPointMidi =
      fields.splitPointMidi !== null && Number.isFinite(fields.splitPointMidi)
        ? Math.min(
            MIDI_NOTE_MAX,
            Math.max(MIDI_NOTE_MIN, Math.round(fields.splitPointMidi))
          )
        : options.splitPointMidi;
  }
  if (fields.minDurationTicks !== undefined) {
    next.minDurationTicks =
      fields.minDurationTicks !== null &&
      Number.isFinite(fields.minDurationTicks)
        ? Math.max(0, Math.round(fields.minDurationTicks))
        : 0;
  }
  if (track) {
    const { sourceIndex, ...row } = track;
    next.trackSelections = options.trackSelections.map(selection =>
      selection.sourceIndex === sourceIndex
        ? { ...selection, ...row }
        : selection
    );
  }
  return next;
}

/**
 * Whether Import is offered: options exist (a file has been read) and at least
 * one track is included. Importing nothing produces an empty score, which is
 * not what anybody means by it.
 */
export function canImportMidi(options: MidiImportOptions | null): boolean {
  return (
    options !== null &&
    options.trackSelections.some(selection => selection.include)
  );
}
