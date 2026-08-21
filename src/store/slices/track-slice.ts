/**
 * Editing the selected track.
 *
 * A property sheet should reflect state and invoke behaviour, not contain it.
 * Everything a track editor does — rename, change instrument, change clef, mix,
 * delete — is a rule about a score, not about a panel: the instrument's name
 * must move with its program, a percussion program addresses a kit rather than
 * an instrument, changing instrument carries the existing notes into the new
 * compass, and the last track cannot be deleted. Every one of those was
 * duplicated in the app once and got at least one of them wrong.
 *
 * So they live here as actions, and the panel calls them with the value its
 * control produced. Each takes its undo `label` from the caller, for the same
 * reason every command does: this library holds no user-facing words.
 *
 * These are conveniences over `dispatchCommand`, not a way around it — they all
 * go through it, so the edit lock (no content changes while the transport
 * plays) and the undo history apply exactly as they do to any other edit.
 */
import type { StateCreator } from 'zustand';
import type { Clef, Track, UUID } from '@sudobility/music_types';
import {
  changeClefCommand,
  changeTrackPropsCommand,
  deleteTrackCommand,
} from '../../domain/commands/structure-commands.js';
import { changeMetadataCommand } from '../../domain/commands/structure-commands.js';
import {
  changeInstrumentCommand,
  fitShiftForInstrument,
} from '../../domain/instruments/instrument-fit.js';
import { instrumentChoiceFor } from '../../domain/instruments/instrument-options.js';
import type { AppState } from '../useAppStore.js';

/** The mixing properties, which stay editable while the transport plays. */
export type TrackMixPatch = Partial<
  Pick<Track, 'volume' | 'pan' | 'muted' | 'solo'>
>;

/**
 * Why an instrument change did nothing.
 *
 * `outOfRange` means the track's music spans more than the instrument can
 * play, so no shift would fit it — the caller has the instrument's name to say
 * so with. `noTrack` means the id no longer resolves.
 */
export type TrackInstrumentResult =
  | { ok: true }
  | { ok: false; reason: 'outOfRange'; instrumentName: string }
  | { ok: false; reason: 'noTrack' };

export type TrackSlice = {
  /** Renames a track. Trimmed, and a blank name is refused rather than stored. */
  renameTrack: (trackId: UUID, name: string, label: string) => void;

  /**
   * Sets the instrument from a catalogue value — the string an
   * `INSTRUMENT_OPTIONS` or `KIT_OPTIONS` control produces, kit prefix and all.
   *
   * Takes the raw value rather than a resolved program so that the kit/melodic
   * distinction is decided in one place: program 40 is Violin *and* the Brush
   * kit, and every caller that resolved it itself eventually got it wrong.
   *
   * Melodic programs carry the existing notes into the new compass; a kit
   * change does not, because a drum part's numbers are kit positions rather
   * than pitches and shifting them would rewrite which drums are played.
   */
  setTrackInstrument: (
    trackId: UUID,
    value: string,
    label: string
  ) => TrackInstrumentResult;

  setTrackClef: (trackId: UUID, clef: Clef, label: string) => void;

  /** Volume, pan, mute and solo — `kind: 'mix'`, so these work while playing. */
  setTrackMix: (trackId: UUID, patch: TrackMixPatch, label: string) => void;

  /**
   * Deletes a track, unless it is the last one.
   *
   * The floor is one: a score with no tracks renders nothing and has no
   * meaningful measure grid to add a track back into. Returns whether it went
   * ahead, and `canDeleteTrack` answers the same question ahead of time so an
   * affordance can be disabled rather than failing on click.
   */
  removeTrack: (trackId: UUID, label: string) => boolean;
  canDeleteTrack: () => boolean;

  /**
   * Sets the score's own title, composer or description.
   *
   * Distinct from the *project* name, which names the row this score is stored
   * in. The title is what travels with the music: it names exported files and
   * fills MusicXML's work title, so a project renamed after creation kept
   * exporting under whatever its template was called until something could
   * write this.
   *
   * A blank title is refused for the same reason a blank track name is —
   * everything downstream uses it as a filename.
   */
  setScoreMetadata: (patch: ScoreMetadataPatch, label: string) => void;
};

/** The metadata fields a user can edit. `createdAt` is the score's, not theirs. */
export type ScoreMetadataPatch = {
  title?: string;
  composer?: string;
  description?: string;
};

export const createTrackSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  TrackSlice
> = (_set, get) => ({
  renameTrack: (trackId, name, label) => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    get().dispatchCommand(
      changeTrackPropsCommand(trackId, { name: trimmed }, label)
    );
  },

  setTrackInstrument: (trackId, value, label) => {
    const { score, dispatchCommand } = get();
    if (!score) return { ok: false, reason: 'noTrack' };

    const choice = instrumentChoiceFor(value);
    const track = score.tracks.find(t => t.id === trackId);
    if (!track) return { ok: false, reason: 'noTrack' };

    if (track.clef === 'percussion') {
      dispatchCommand(
        changeTrackPropsCommand(
          trackId,
          {
            midiProgram: choice.midiProgram,
            instrumentName: choice.instrumentName,
          },
          label
        )
      );
      return { ok: true };
    }

    // Asked before dispatching, so a change that would be refused is reported
    // rather than silently doing nothing — the command itself returns the
    // score untouched in that case.
    if (fitShiftForInstrument(score, trackId, choice.midiProgram) === null)
      return {
        ok: false,
        reason: 'outOfRange',
        instrumentName: choice.instrumentName,
      };

    dispatchCommand(
      changeInstrumentCommand(
        trackId,
        {
          midiProgram: choice.midiProgram,
          instrumentName: choice.instrumentName,
        },
        label
      )
    );
    return { ok: true };
  },

  setTrackClef: (trackId, clef, label) => {
    get().dispatchCommand(changeClefCommand(trackId, clef, label));
  },

  setTrackMix: (trackId, patch, label) => {
    get().dispatchCommand(changeTrackPropsCommand(trackId, patch, label));
  },

  removeTrack: (trackId, label) => {
    if (!get().canDeleteTrack()) return false;
    get().dispatchCommand(deleteTrackCommand(trackId, label));
    return true;
  },

  canDeleteTrack: () => (get().score?.tracks.length ?? 0) > 1,

  setScoreMetadata: (patch, label) => {
    const trimmed: ScoreMetadataPatch = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title === '') return;
      trimmed.title = title;
    }
    if (patch.composer !== undefined) trimmed.composer = patch.composer.trim();
    if (patch.description !== undefined)
      trimmed.description = patch.description.trim();

    get().dispatchCommand(changeMetadataCommand(trimmed, label));
  },
});
