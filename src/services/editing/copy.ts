/**
 * The words an edit is described in, supplied by the host application.
 *
 * Editing moved into this library so a second app cannot reimplement it
 * differently — but an edit still has to be *named*, in the undo history and in
 * the occasional toast, and this library holds no user-facing strings in any
 * language. Same split the commands themselves already use: a command takes its
 * label as an argument, because the same command is "Add note" here and
 * something else in another locale.
 *
 * The host sets this once at bootstrap, exactly as it sets `setLibraryMessages`
 * and `setErrorLogging`. Before it does, every label is empty — deliberately,
 * not English: a missing label then shows as nothing at all, which is visible
 * in review, where a plausible English default would ship silently in a Chinese
 * build and look like a translation someone forgot.
 */

/** One key per command, named for the command rather than its wording. */
export type CommandLabelKey =
  | 'addNote'
  | 'addMeasure'
  | 'addTrack'
  | 'changeAccidental'
  | 'changeArticulation'
  | 'changeDuration'
  | 'changeDynamic'
  | 'changePitch'
  | 'changeClef'
  | 'changeKeySignature'
  | 'changeRepeats'
  | 'changeMetadata'
  | 'changeTempo'
  | 'changeTimeSignature'
  | 'changeTrackProps'
  | 'changeVelocity'
  | 'deleteEvents'
  | 'changeVoice'
  | 'deleteMeasure'
  | 'deleteTrack'
  | 'importScore'
  | 'insertWithRipple'
  | 'moveNotes'
  | 'pasteEvents'
  | 'quantize'
  | 'relocateNotes'
  | 'resizeNotes'
  | 'setChordSymbol'
  | 'setFingering'
  | 'setPickup'
  | 'setLyric'
  | 'toGraceNote'
  | 'changeBeam'
  | 'changeBarline'
  | 'changeMeasureClef'
  | 'changeNavigation'
  | 'changeOrnament'
  | 'toggleArpeggiate'
  | 'toggleGlissando'
  | 'toggleOttava'
  | 'toggleFermata'
  | 'toggleHairpin'
  | 'toggleSlur'
  | 'toggleTie'
  | 'transpose';

export type EditingCopy = {
  /**
   * What each command is called in the undo history.
   *
   * A resolver rather than a snapshot: labels are read at dispatch time, so the
   * label stored in history is the one the edit was actually made under — which
   * is what you want when reading back what you did, and what a table captured
   * at bootstrap would get wrong the moment somebody switches language.
   */
  commandLabel: (key: CommandLabelKey) => string;
  /**
   * An edit introduced a validation error that was not there before.
   *
   * A function rather than a string because it has to carry the validator's own
   * account of what went wrong, and where that detail sits in the sentence is a
   * question about the language, not about the edit.
   */
  validationProblem: (detail: string) => string;
  /** Refusing to delete a track's only measure. */
  lastMeasureKept: string;
};

let copy: EditingCopy = {
  commandLabel: () => '',
  validationProblem: () => '',
  lastMeasureKept: '',
};

/** Called once at bootstrap by the host application. */
export function setEditingCopy(next: EditingCopy): void {
  copy = next;
}

export function commandLabel(key: CommandLabelKey): string {
  return copy.commandLabel(key);
}

export function editingCopy(): EditingCopy {
  return copy;
}
