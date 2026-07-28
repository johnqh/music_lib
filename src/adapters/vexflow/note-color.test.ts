import { describe, expect, it } from 'vitest';
import { noteColorFor, resolveNoteColorRole } from './note-color.js';
import type { NoteColorRole, RenderTheme } from './types.js';

const theme: RenderTheme = {
  foreground: '#foreground',
  noteNormal: '#normal',
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
