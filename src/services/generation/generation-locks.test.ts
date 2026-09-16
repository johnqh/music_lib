import { describe, expect, it } from 'vitest';
import type {
  GenerationChoices,
  GenerationRecord,
} from '@sudobility/music_types';
import {
  generationChoiceLabelKey,
  lockableChoiceRows,
  lockableChoiceValue,
  regenerateCreditEstimate,
  regenerateWithLocks,
} from './generation-locks.js';
import { LOCKABLE } from '@sudobility/music_types';

const choices: GenerationChoices = {
  formShape: 'AABA',
  cycle: 'I-V-vi-IV',
  hook: 'rising third',
  groove: 'one drop',
  arcEntry: 'sparse',
  arcIntensity: 'build',
  moment: null,
  carrier: 1,
  carrierName: 'Violin',
  lyric: null,
};

const record: GenerationRecord = {
  request: {
    prompt: 'a song',
    durationMeasures: 16,
    tracks: [
      {
        name: 'Voice',
        instrumentName: 'Voice',
        midiProgram: 53,
        clef: 'treble',
      },
      {
        name: 'Violin',
        instrumentName: 'Violin',
        midiProgram: 40,
        clef: 'treble',
      },
    ],
    choices: { hook: 'an old hook' },
  },
  choices,
};

describe('LOCKABLE', () => {
  it('lists the choices in the order the panel shows them', () => {
    expect(LOCKABLE).toEqual([
      'groove',
      'cycle',
      'arcEntry',
      'arcIntensity',
      'moment',
      'carrier',
      'formShape',
      'hook',
      'lyric',
    ]);
  });
});

describe('lockableChoiceValue', () => {
  it('shows the carrier by its track name, not its index', () => {
    expect(lockableChoiceValue(choices, 'carrier')).toBe('Violin');
    expect(lockableChoiceValue(choices, 'groove')).toBe('one drop');
    expect(lockableChoiceValue(choices, 'moment')).toBeNull();
  });
});

describe('lockableChoiceRows', () => {
  it('offers only the choices the server actually made', () => {
    expect(lockableChoiceRows(record)).toEqual([
      'groove',
      'cycle',
      'arcEntry',
      'arcIntensity',
      'carrier',
      'formShape',
      'hook',
    ]);
  });
});

describe('regenerateWithLocks', () => {
  it('sends the same request with only the locked choices kept', () => {
    const request = regenerateWithLocks(record, ['groove', 'carrier']);
    expect(request).toEqual({
      ...record.request,
      choices: { groove: 'one drop', carrier: 1 },
    });
  });

  it('replaces whatever choices the old request carried', () => {
    expect(regenerateWithLocks(record, []).choices).toEqual({});
  });

  it('does not touch the record it was given', () => {
    regenerateWithLocks(record, ['hook']);
    expect(record.request.choices).toEqual({ hook: 'an old hook' });
  });
});

describe('regenerateCreditEstimate', () => {
  it('quotes the same request at the same bill: bars times tracks', () => {
    expect(regenerateCreditEstimate(record)).toBe(32);
  });
});

describe('generationChoiceLabelKey', () => {
  it('names the locale entry', () => {
    expect(generationChoiceLabelKey('arcEntry')).toBe(
      'generationChoices.arcEntry'
    );
  });
});
