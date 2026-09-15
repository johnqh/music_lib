import { describe, expect, it } from 'vitest';
import { NO_MARK } from '@sudobility/music_types';
import {
  complexityLabelKey,
  labelledOptions,
  moodLabelKey,
  optionalFromPicker,
  optionalToPicker,
  styleLabelKey,
} from './labelled-options.js';

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
