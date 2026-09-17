/**
 * The frontend vocabulary this package used to declare lives in music_types.
 *
 * This package re-exports music_types, music_codecs and music_drawing
 * wholesale. A name that one of them owns and this package also
 * declares — or re-exports from a module of its own — reaches every consumer
 * by two routes: a TS2308 in this build and a "Cannot redefine property" crash
 * in a CommonJS consumer. So the moved names stay moved, and the modules that
 * came here from music_editing stay here (their guard is on that side).
 */
import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';

const MOVED = [
  'GENERATE_SCORE_MOOD_OPTIONS',
  'GENERATE_SCORE_COMPLEXITY_OPTIONS',
  'GENERATE_SCORE_KEY_FIFTHS_OPTIONS',
  'GenerateScoreKeyFifthsOption',
  'GENERATE_SCORE_TIME_SIGNATURE_OPTIONS',
  'GenerateScoreComplexity',
  'GenerateTrackRequest',
  'StyleTier',
  'StyleRosterEntry',
  'InstrumentValueEntry',
  'GenerateScoreRequestDraft',
  'NewProjectDraft',
  'NewProjectSubmission',
  'NewProjectFormDraft',
  'NewProjectDraftAction',
  'NewProjectEntry',
  'LOCKABLE',
  'LockableChoice',
  'REPLACE_PRESET_KEYS',
  'ReplacePresetKey',
  'ReplaceDraft',
  'LabelledOption',
  'TEMPLATE_IDS',
  'TemplateId',
  'TemplateCopy',
  'FONT_SIZES',
  'FontSize',
  'DevicePrefs',
  'DevSettings',
  'THEME_MODES',
  'ThemeMode',
  'ResolvedThemeMode',
  'SaveState',
  'DocumentOrigin',
  'DocumentFileStorage',
  'PrefsStorage',
  'ToastSink',
  'Toast',
  'AppErrorCode',
  'AppErrorOptions',
  'LibraryMessages',
  'LibraryMessageKey',
  'LibraryCopy',
  'MidiImportPatch',
  'TransportSettings',
  'PlayerFailure',
  'WRITABLE_EXPORT_FORMATS',
  'ExportFormatId',
  'ExportPlan',
  'ExportScope',
  'ExportRoute',
  'DOCS_TOPIC_IDS',
  'DocsTopicId',
  'DocsTopic',
  'DocsGroup',
  'DOCS_GROUPS',
  'Resource',
  'ResourceGroup',
];

describe('names that moved to music_types', () => {
  it('are neither declared nor re-exported by any source file', () => {
    const offenders: string[] = [];
    for (const file of globSync('src/**/*.{ts,tsx}')) {
      if (file.includes('.test.')) continue;
      const text = readFileSync(file, 'utf8');
      for (const name of MOVED) {
        const declared = new RegExp(
          `export\\s+(?:declare\\s+)?(?:type|interface|const|class|function|enum)\\s+${name}\\b`
        );
        const reexported = new RegExp(
          `export\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}`
        );
        if (declared.test(text) || reexported.test(text))
          offenders.push(`${name} in ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps no structural copy of the player for the binder', () => {
    // `BindablePlayer` was deleted rather than moved: music_editing's binder
    // needed a hand-kept copy of the player's methods because it could not
    // import music_player. Here the binder takes `IMusicPlayer` itself.
    const offenders = globSync('src/**/*.{ts,tsx}').filter(
      file =>
        !file.includes('.test.') &&
        /\bBindablePlayer\b/.test(readFileSync(file, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
