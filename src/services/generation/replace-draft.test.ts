import { describe, expect, it } from 'vitest';
import {
  buildReplaceSubmission,
  defaultReplaceSubmission,
  replacePresetLabelKey,
} from './replace-draft.js';
import { DEFAULT_GENERATION_VARIANT } from './new-project-draft.js';
import { REPLACE_PRESET_KEYS } from '@sudobility/music_types';

describe('REPLACE_PRESET_KEYS', () => {
  it('is the full list the web dialog offers, in its order, once each', () => {
    expect(REPLACE_PRESET_KEYS).toHaveLength(14);
    expect(REPLACE_PRESET_KEYS[0]).toBe('moreDramatic');
    expect(REPLACE_PRESET_KEYS.at(-1)).toBe('thinOrchestration');
    expect(new Set(REPLACE_PRESET_KEYS).size).toBe(14);
  });

  it('names each preset by a locale key, never by its words', () => {
    expect(replacePresetLabelKey('darker')).toBe('replace.preset.darker');
  });
});

describe('defaultReplaceSubmission', () => {
  it('opens with the web values: no style or mood, moderate, DeepSeek, nothing preserved', () => {
    expect(defaultReplaceSubmission()).toEqual({
      instruction: '',
      style: '',
      mood: '',
      complexity: 'moderate',
      variant: DEFAULT_GENERATION_VARIANT,
      constraints: {
        preserveBoundaryNotes: false,
        preserveHarmony: false,
        preserveRhythm: false,
        preserveMelody: false,
      },
    });
  });

  it('is a fresh object each time, so a form cannot mutate the next one', () => {
    const first = defaultReplaceSubmission();
    first.constraints.preserveMelody = true;
    expect(defaultReplaceSubmission().constraints.preserveMelody).toBe(false);
  });
});

describe('buildReplaceSubmission', () => {
  it('refuses a blank instruction', () => {
    expect(buildReplaceSubmission(defaultReplaceSubmission())).toBeNull();
    expect(
      buildReplaceSubmission({
        ...defaultReplaceSubmission(),
        instruction: '  ',
      })
    ).toBeNull();
  });

  it('trims the instruction and omits an empty style and mood', () => {
    const submission = buildReplaceSubmission({
      ...defaultReplaceSubmission(),
      instruction: '  Resolve the phrase ',
    });
    expect(submission).toEqual({
      instruction: 'Resolve the phrase',
      complexity: 'moderate',
      variant: DEFAULT_GENERATION_VARIANT,
      constraints: {
        preserveBoundaryNotes: false,
        preserveHarmony: false,
        preserveRhythm: false,
        preserveMelody: false,
      },
    });
    expect(submission).not.toHaveProperty('style');
    expect(submission).not.toHaveProperty('mood');
  });

  it('carries a chosen style, mood and constraints', () => {
    const submission = buildReplaceSubmission({
      ...defaultReplaceSubmission(),
      instruction: 'x',
      style: 'jazz',
      mood: 'dark',
      complexity: 'complex',
      variant: 'local',
      constraints: {
        preserveBoundaryNotes: true,
        preserveHarmony: true,
        preserveRhythm: false,
        preserveMelody: false,
      },
    });
    expect(submission).toMatchObject({
      style: 'jazz',
      mood: 'dark',
      complexity: 'complex',
      variant: 'local',
      constraints: { preserveBoundaryNotes: true, preserveHarmony: true },
    });
  });
});
