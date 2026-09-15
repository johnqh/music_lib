/**
 * The copy both apps hand the libraries, built once from a `t`.
 *
 * The web app and the native app each wrote these tables out — the same keys,
 * the same interpolation — and each captured some of them as strings at start-up,
 * so switching language left the undo history's refusals and the selection
 * readout in the old one.
 */
import { describe, expect, it } from 'vitest';
import { REFUSED_EDITS } from '@sudobility/music_editing';
import { createLibraryCopy, type Translate } from './library-copy.js';
import { TEMPLATE_IDS } from '../templates/index.js';

/** A `t` that writes the key, its options and the current language. */
function fakeT(): { t: Translate; setLanguage: (lang: string) => void } {
  let language = 'en';
  return {
    setLanguage: next => {
      language = next;
    },
    t: (key, options) =>
      `${language}:${key}${options ? JSON.stringify(options) : ''}`,
  };
}

describe('createLibraryCopy', () => {
  it('reads every entry at the moment it is used, so a language switch takes', () => {
    const { t, setLanguage } = fakeT();
    const copy = createLibraryCopy(t);
    // Held, as a host holds them after handing them to the library at start-up.
    const editing = copy.editing();
    const selection = copy.selection();
    const warnings = copy.musicXmlWarnings();
    const library = copy.library();

    setLanguage('zh');

    expect(editing.lastMeasureKept).toBe('zh:editor.lastMeasureKept');
    expect(editing.commandLabel('addNote')).toBe('zh:command.addNote');
    expect(editing.undoAction()).toBe('zh:editor.undo');
    expect(selection.none).toBe('zh:selection.none');
    expect(warnings.complexTimeSignature).toBe(
      'zh:musicXmlWarn.complexTimeSignature'
    );
    expect(warnings.unpitched).toBe('zh:musicXmlWarn.unpitched');
    expect(library.saveFailed()).toBe('zh:library.saveFailed');
    expect(copy.templates()['waltz'].name).toBe('zh:templates.waltz.name');
  });

  it('builds the out-of-range refusal from facts, with the refused edit translated', () => {
    const { t } = fakeT();
    const editing = createLibraryCopy(t).editing();
    expect(
      editing.outOfRange({
        pitch: 'C2',
        instrument: 'Violin',
        low: 'G3',
        high: 'A7',
        direction: 'below',
        refused: 'paste',
      })
    ).toBe(
      'en:editor.outOfRange.below' +
        JSON.stringify({
          pitch: 'C2',
          instrument: 'Violin',
          low: 'G3',
          high: 'A7',
          action: 'en:editor.refused.paste',
        })
    );
  });

  it('picks the one-note or many-note polyphony sentence, and names an unknown instrument', () => {
    const { t } = fakeT();
    const editing = createLibraryCopy(t).editing();
    expect(
      editing.tooManyNotes({
        instrument: 'Flute',
        limit: 1,
        refused: 'addChord',
      })
    ).toBe(
      'en:editor.polyphonyOne' +
        JSON.stringify({
          instrument: 'Flute',
          limit: 1,
          action: 'en:editor.refused.addChord',
        })
    );
    expect(
      editing.tooManyNotes({ instrument: null, limit: 2, refused: 'addChord' })
    ).toContain('"instrument":"en:editor.unknownInstrument"');
    expect(
      editing.tooManyNotes({ instrument: null, limit: 2, refused: 'addChord' })
    ).toMatch(/^en:editor\.polyphonyMany/);
  });

  it('translates every refused edit the engine can report', () => {
    const { t } = fakeT();
    const editing = createLibraryCopy(t).editing();
    for (const refused of REFUSED_EDITS) {
      expect(
        editing.tooManyNotes({ instrument: 'X', limit: 2, refused })
      ).toContain(`editor.refused.${refused}`);
    }
  });

  it('plurals counts through t rather than appending an s', () => {
    const { t } = fakeT();
    const selection = createLibraryCopy(t).selection();
    expect(selection.notes(3)).toBe('en:selection.notes{"count":3}');
    expect(selection.regenerated('x')).toBe(
      'en:selection.regenerated{"summary":"x"}'
    );
  });

  it('names and describes every template', () => {
    const { t } = fakeT();
    const templates = createLibraryCopy(t).templates();
    expect(Object.keys(templates).sort()).toEqual([...TEMPLATE_IDS].sort());
    expect(templates['jig'].description).toBe('en:templates.jig.description');
  });

  it('passes the importer its found values by name', () => {
    const { t } = fakeT();
    const warnings = createLibraryCopy(t).musicXmlWarnings();
    expect(warnings.unsupportedClef('C', 3)).toBe(
      'en:musicXmlWarn.unsupportedClef{"sign":"C","line":3}'
    );
    expect(warnings.tempoClamped(400, 20, 300, 300)).toBe(
      'en:musicXmlWarn.tempoClamped{"bpm":400,"min":20,"max":300,"clamped":300}'
    );
  });
});
