import { describe, expect, it } from 'vitest';
import { noteColorFor, noteEmphasisFor, resolveNoteColorRole } from './note-color.js';
import type { NoteColorRole, RenderTheme } from './types.js';

const theme: RenderTheme = {
  foreground: '#foreground',
  noteNormal: '#normal',
  noteInactive: '#inactive',
  noteSelected: '#selected',
  noteRegenerated: '#regenerated',
  notePlaying: '#playing',
  staveActive: '#staveActive',
  staveInactive: '#staveInactive',
  caret: '#caret',
};

describe('resolveNoteColorRole', () => {
  it('returns normal when there is no map', () => {
    expect(resolveNoteColorRole(['a'], undefined)).toBe('normal');
  });

  it('returns normal for an id absent from the map', () => {
    const map = new Map<string, NoteColorRole>([['other', 'selected']]);
    expect(resolveNoteColorRole(['a'], map)).toBe('normal');
  });

  it('returns the role of a single mapped id', () => {
    const map = new Map<string, NoteColorRole>([['a', 'selected']]);
    expect(resolveNoteColorRole(['a'], map)).toBe('selected');
  });

  it('takes the highest-precedence role across a chord', () => {
    const map = new Map<string, NoteColorRole>([
      ['a', 'selected'],
      ['b', 'playing'],
    ]);
    expect(resolveNoteColorRole(['a', 'b'], map)).toBe('playing');
  });

  it('ranks regenerated above selected', () => {
    const map = new Map<string, NoteColorRole>([
      ['a', 'selected'],
      ['b', 'regenerated'],
    ]);
    expect(resolveNoteColorRole(['a', 'b'], map)).toBe('regenerated');
  });

  it('ranks playing above regenerated', () => {
    const map = new Map<string, NoteColorRole>([
      ['a', 'regenerated'],
      ['b', 'playing'],
    ]);
    expect(resolveNoteColorRole(['a', 'b'], map)).toBe('playing');
  });

  it('returns normal for an empty id list', () => {
    const map = new Map<string, NoteColorRole>([['a', 'playing']]);
    expect(resolveNoteColorRole([], map)).toBe('normal');
  });

  it('returns normal for an empty map', () => {
    expect(resolveNoteColorRole(['a'], new Map())).toBe('normal');
  });
});

describe('noteColorFor', () => {
  it('maps every role to its theme color', () => {
    expect(noteColorFor('normal', theme)).toBe('#normal');
    expect(noteColorFor('selected', theme)).toBe('#selected');
    expect(noteColorFor('regenerated', theme)).toBe('#regenerated');
    expect(noteColorFor('playing', theme)).toBe('#playing');
  });
});

describe('noteEmphasisFor', () => {
  it('leaves normal notes unemphasised', () => {
    expect(noteEmphasisFor('normal')).toEqual({ lineWidth: 1 });
  });

  it('emphasises every non-normal state, so state is perceivable without color', () => {
    for (const role of ['selected', 'regenerated', 'playing'] as const) {
      expect(noteEmphasisFor(role).lineWidth).toBeGreaterThan(
        noteEmphasisFor('normal').lineWidth,
      );
    }
  });

  it('never asks for a shadow', () => {
    // Canvas shadows force a per-draw blur pass in the rasterizer, and this
    // is applied to the notes that change on every note-on/note-off during
    // playback. Regression guard: reintroducing one here is what made
    // playback hesitate.
    for (const role of ['normal', 'selected', 'regenerated', 'playing'] as const) {
      expect(noteEmphasisFor(role)).not.toHaveProperty('shadowBlur');
      expect(noteEmphasisFor(role)).not.toHaveProperty('shadowColor');
    }
  });
});

describe('noteColorFor: inactive tracks', () => {
  it('dims an unstyled note that is not on the active track', () => {
    expect(noteColorFor('normal', theme, false)).toBe('#inactive');
    expect(noteColorFor('normal', theme, true)).toBe('#normal');
  });

  it('defaults to the active-track colour, so existing callers are unchanged', () => {
    expect(noteColorFor('normal', theme)).toBe('#normal');
  });

  it('never dims a note that carries state, wherever it is', () => {
    // cmd-shift-click selects across every track, so dimming a selection that
    // happens to sit off the active track would hide what the user just did.
    for (const role of ['selected', 'regenerated', 'playing'] as const) {
      expect(noteColorFor(role, theme, false)).toBe(noteColorFor(role, theme, true));
    }
  });
});
