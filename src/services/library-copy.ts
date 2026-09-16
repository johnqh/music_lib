/**
 * The words the libraries need, built from the host's `t`.
 *
 * music_editing, music_codecs, music_types and this package hold no strings in
 * any language: an edit's undo label, a refusal, a MusicXML warning, the
 * selection readout, an autosave failure and a template's name all come from
 * the host. That split is right. But both apps then wrote the same five tables
 * out by hand — the same keys, the same interpolation, the same choice between
 * the one-note and many-note polyphony sentence — and a table written twice is
 * a table that drifts.
 *
 * So the construction lives here and only the translating stays in each app:
 * a host passes its `t`, and the keys are this module's. **Keys only** — the
 * sentences stay in each app's locale files, where `locale-parity` and the
 * cross-app parity test can see them.
 *
 * **Every entry is read when it is used, never when the table is built.** Both
 * apps captured some of these as strings at start-up (`lastMeasureKept`, the
 * selection's `none`, the argument-free MusicXML warnings), which strands
 * whatever language was loaded first: a reader who switched to Chinese went on
 * being told in English why a bar could not be deleted. Where a contract
 * declares a `string` rather than a function, the entry is a getter, so it is
 * still resolved on each read — the type stays as the owning package declared
 * it, and nothing a host holds goes stale.
 */
import { TEMPLATE_IDS } from '@sudobility/music_types';
import type {
  EditingCopy,
  LibraryCopy,
  TemplateCopy,
} from '@sudobility/music_types';
import { setEditingCopy } from '@sudobility/music_editing';
import { setLibraryMessages } from './messages.js';

/**
 * A host's translate function, structurally.
 *
 * i18next's `t` fits once wrapped — `(key, options) => i18next.t(key, options)`
 * — and a test passes a plain function. Typed loosely on purpose: the keys are
 * built from vocabularies at runtime, which no typed-resources `t` accepts.
 */
export type Translate = (
  key: string,
  options?: Record<string, unknown>
) => string;

export function createLibraryCopy(t: Translate): LibraryCopy {
  const commandLabel: EditingCopy['commandLabel'] = key => t(`command.${key}`);

  return {
    editing: () => ({
      commandLabel,
      validationProblem: detail => t('editor.validationProblem', { detail }),
      get lastMeasureKept() {
        return t('editor.lastMeasureKept');
      },
      // The engine hands over facts — the pitch, the instrument, its compass,
      // the side and what was refused — and the sentence is the host's, so its
      // word order can follow the language rather than English.
      outOfRange: ({ pitch, instrument, low, high, direction, refused }) =>
        t(`editor.outOfRange.${direction}`, {
          pitch,
          instrument,
          low,
          high,
          action: t(`editor.refused.${refused}`),
        }),
      tooManyNotes: ({ instrument, limit, refused }) =>
        t(limit === 1 ? 'editor.polyphonyOne' : 'editor.polyphonyMany', {
          instrument: instrument ?? t('editor.unknownInstrument'),
          limit,
          action: t(`editor.refused.${refused}`),
        }),
      undoAction: () => t('editor.undo'),
    }),

    // Counts go through the host's plural handling rather than an appended
    // "s", which is an English-only rule.
    selection: () => ({
      notes: count => t('selection.notes', { count }),
      measures: count => t('selection.measures', { count }),
      tracks: count => t('selection.tracks', { count }),
      get none() {
        return t('selection.none');
      },
      regenerated: summary => t('selection.regenerated', { summary }),
    }),

    musicXmlWarnings: () => ({
      unsupportedClef: (sign, line) =>
        t('musicXmlWarn.unsupportedClef', { sign, line }),
      unsupportedKeyMode: mode =>
        t('musicXmlWarn.unsupportedKeyMode', { mode }),
      unsupportedTime: measureNumber =>
        t('musicXmlWarn.unsupportedTime', { measureNumber }),
      get complexTimeSignature() {
        return t('musicXmlWarn.complexTimeSignature');
      },
      unsupportedPitchStep: step =>
        t('musicXmlWarn.unsupportedPitchStep', { step }),
      alterRounded: (alter, clamped) =>
        t('musicXmlWarn.alterRounded', { alter, clamped }),
      unsupportedNotation: tag =>
        t('musicXmlWarn.unsupportedNotation', { tag }),
      unsupportedNoteElement: tag =>
        t('musicXmlWarn.unsupportedNoteElement', { tag }),
      unsupportedArticulation: tag =>
        t('musicXmlWarn.unsupportedArticulation', { tag }),
      get multipleArticulations() {
        return t('musicXmlWarn.multipleArticulations');
      },
      get unpitched() {
        return t('musicXmlWarn.unpitched');
      },
      get noPitchOrRest() {
        return t('musicXmlWarn.noPitchOrRest');
      },
      get noDuration() {
        return t('musicXmlWarn.noDuration');
      },
      get nonPositiveDuration() {
        return t('musicXmlWarn.nonPositiveDuration');
      },
      get noteTrimmed() {
        return t('musicXmlWarn.noteTrimmed');
      },
      unsupportedMeasureElement: tag =>
        t('musicXmlWarn.unsupportedMeasureElement', { tag }),
      noTempo: defaultBpm => t('musicXmlWarn.noTempo', { defaultBpm }),
      tempoClamped: (bpm, min, max, clamped) =>
        t('musicXmlWarn.tempoClamped', { bpm, min, max, clamped }),
    }),

    library: () => ({
      retry: () => t('library.retry'),
      saveFailed: () => t('library.saveFailed'),
      playbackFailed: () => t('library.playbackFailed'),
      scoreLoadFailed: () => t('library.scoreLoadFailed'),
      authRequired: () => t('library.authRequired'),
      serverUnavailable: () => t('library.serverUnavailable'),
    }),

    templates: () => {
      const copy = {} as Record<
        (typeof TEMPLATE_IDS)[number],
        { name: string; description: string }
      >;
      for (const id of TEMPLATE_IDS) {
        copy[id] = {
          get name() {
            return t(`templates.${id}.name`);
          },
          get description() {
            return t(`templates.${id}.description`);
          },
        };
      }
      return copy satisfies TemplateCopy;
    },
  };
}

/**
 * Hands the library the two catalogues it reads from inside — editing and
 * library messages — at bootstrap. The other three are passed at the call that
 * needs them (`selectionSummaryLabel`, `openMusicXml`, `projectTemplates`).
 */
export function installLibraryCopy(copy: LibraryCopy): void {
  setEditingCopy(copy.editing());
  setLibraryMessages(copy.library());
}
