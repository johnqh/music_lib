import { describe, expect, it } from 'vitest';
import { GENERATE_SCORE_STYLE_OPTIONS, NO_MARK } from '@sudobility/music_types';
import {
  complexityLabelKey,
  flatStyleOptions,
  groupedStyleOptions,
  labelledOptions,
  moodLabelKey,
  optionalFromPicker,
  optionalToPicker,
  styleFamilyLabelKey,
  styleLabelKey,
} from './labelled-options';

const LABELS: Record<string, string> = {
  pop: 'Pop',
  electroSwing: 'Electro Swing',
  ambient: 'Ambient',
};

describe('labelledOptions', () => {
  it('pairs each value with its label, sorted on the label', () => {
    expect(
      labelledOptions(['pop', 'electroSwing', 'ambient'], v => LABELS[v])
    ).toEqual([
      { value: 'ambient', label: 'Ambient' },
      { value: 'electroSwing', label: 'Electro Swing' },
      { value: 'pop', label: 'Pop' },
    ]);
  });

  it('pins the "none" entry above the vocabulary when a label is given', () => {
    const options = labelledOptions(
      ['pop', 'ambient'],
      v => LABELS[v],
      'en',
      'No style'
    );
    expect(options[0]).toEqual({ value: NO_MARK, label: 'No style' });
    expect(options.map(option => option.value)).toEqual([
      NO_MARK,
      'ambient',
      'pop',
    ]);
  });

  it('sorts under the locale it is given', () => {
    // Swedish collates "ä" after "z"; English collates it beside "a".
    const words = ['ä', 'z'];
    expect(
      labelledOptions(words, v => v, 'sv').map(option => option.value)
    ).toEqual(['z', 'ä']);
    expect(
      labelledOptions(words, v => v, 'en').map(option => option.value)
    ).toEqual(['ä', 'z']);
  });

  it('does not reorder the vocabulary it was handed', () => {
    const values = ['pop', 'ambient'];
    labelledOptions(values, v => LABELS[v]);
    expect(values).toEqual(['pop', 'ambient']);
  });
});

describe('label keys', () => {
  it('name the locale entries both apps carry', () => {
    expect(styleLabelKey('electroSwing')).toBe(
      'generateScore.styleName.electroSwing'
    );
    expect(moodLabelKey('calm')).toBe('generateScore.moodName.calm');
    expect(complexityLabelKey('simple')).toBe(
      'generateScore.complexityName.simple'
    );
  });
});

describe('optional picker values', () => {
  it('maps "none" between a draft and a picker that cannot hold empty', () => {
    expect(optionalToPicker('')).toBe(NO_MARK);
    expect(optionalToPicker('pop')).toBe('pop');
    expect(optionalFromPicker(NO_MARK)).toBe('');
    expect(optionalFromPicker('pop')).toBe('pop');
  });
});

describe('style families in the picker', () => {
  const styleLabel = (style: string): string => `s:${style}`;
  const familyLabel = (family: string): string => `f:${family}`;

  it('files every style under exactly one heading', () => {
    const groups = groupedStyleOptions(styleLabel, familyLabel, 'en');
    const values = groups.flatMap(group => group.options.map(o => o.value));
    expect([...values].sort()).toEqual(
      [...GENERATE_SCORE_STYLE_OPTIONS].sort()
    );
    expect(new Set(values).size).toBe(values.length);
  });

  it('sorts the headings and the styles under them on their labels', () => {
    const groups = groupedStyleOptions(styleLabel, familyLabel, 'en');
    const headings = groups.map(group => group.label);
    expect(headings).toEqual([...headings].sort((a, b) => a.localeCompare(b)));
    for (const group of groups) {
      const labels = group.options.map(o => o.label);
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('names the family in each flat entry and pins "none" on top', () => {
    const flat = flatStyleOptions(styleLabel, familyLabel, 'en', 'No style');
    expect(flat[0]).toEqual({ value: NO_MARK, label: 'No style' });
    expect(flat.find(o => o.value === 'swing')?.label).toBe('f:jazz · s:swing');
    expect(flat).toHaveLength(GENERATE_SCORE_STYLE_OPTIONS.length + 1);
  });

  it('keys the heading words like the style names', () => {
    expect(styleFamilyLabelKey('jazz')).toBe('generateScore.styleFamily.jazz');
  });
});
