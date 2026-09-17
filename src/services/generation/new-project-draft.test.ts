import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTRUMENT_VALUE,
  DEFAULT_VOCAL_INSTRUMENT_VALUE,
  GENERATE_SCORE_STYLE_PRESETS,
  styleTempoRange,
} from '@sudobility/music_types';
import {
  DEFAULT_GENERATE_SCORE_MEASURES,
  hasVocalInstrument,
  styleKey,
  styleRoster,
  styleTempo,
} from './request.js';
import { formatDuration, secondsForBars } from './score-duration.js';
import {
  DEFAULT_GENERATION_VARIANT,
  canCreateNewProject,
  canRemoveNewProjectEntry,
  initialNewProjectDraft,
  isNewProjectEntryLocked,
  newProjectCreditEstimate,
  newProjectDefaultTitleKey,
  newProjectDurationRefused,
  newProjectRequestDraft,
  newProjectSubmission,
  newProjectTempoRefused,
  reduceNewProjectDraft,
  showNewProjectDuration,
  showNewProjectLyrics,
  showNewProjectLyricsTheme,
} from './new-project-draft.js';
import { GENERATE_SCORE_TIME_SIGNATURE_OPTIONS } from '@sudobility/music_types';
import type {
  NewProjectDraftAction,
  NewProjectFormDraft,
} from '@sudobility/music_types';

/** A fixed draw, so a style's roster, tempo and key are the same every run. */
const zero = (): number => 0;

function run(
  actions: NewProjectDraftAction[],
  from: NewProjectFormDraft = initialNewProjectDraft()
): NewProjectFormDraft {
  return actions.reduce(
    (draft, action) => reduceNewProjectDraft(draft, action, zero),
    from
  );
}

const values = (draft: NewProjectFormDraft): string[] =>
  draft.ensemble.map(entry => entry.value);

describe('initialNewProjectDraft', () => {
  it('opens as a blank piano project of the default length', () => {
    const draft = initialNewProjectDraft();
    expect(draft.generating).toBe(false);
    expect(values(draft)).toEqual([DEFAULT_INSTRUMENT_VALUE]);
    expect(draft.measuresText).toBe(String(DEFAULT_GENERATE_SCORE_MEASURES));
    expect(draft.tempoText).toBe('');
    expect(draft.meter).toBe('4/4');
    expect(draft.keySignature).toEqual({ fifths: 0, mode: 'major' });
    expect(draft.style).toBe('');
    expect(draft.mood).toBe('');
    expect(draft.complexity).toBe('moderate');
    expect(draft.variant).toBe(DEFAULT_GENERATION_VARIANT);
    expect(draft.lyrics).toBe(true);
    expect(draft.durationText).toBe(
      formatDuration(secondsForBars(DEFAULT_GENERATE_SCORE_MEASURES, ''))
    );
  });

  it('defaults to DeepSeek, the backend listeners preferred', () => {
    expect(DEFAULT_GENERATION_VARIANT).toBe('deepseek');
  });
});

describe('applyStyle', () => {
  it('fills the roster, tempo, bars, meter and key from the style', () => {
    const draft = run([{ type: 'applyStyle', style: 'pop' }]);
    const roster = styleRoster('pop', { voice: false }, zero);
    expect(draft.ensemble).toEqual(
      roster.map((entry, id) => ({ id, value: entry.value, tier: entry.tier }))
    );
    expect(draft.nextEntryId).toBe(roster.length);
    const pace = styleTempo('pop', zero)!;
    expect(draft.tempoText).toBe(String(pace.tempo));
    expect(draft.measuresText).toBe(String(pace.measures));
    expect(draft.meter).toBe(GENERATE_SCORE_STYLE_PRESETS.pop.timeSignature);
    expect(draft.keySignature).toEqual(styleKey('pop', zero));
    expect(draft.durationText).toBe(
      formatDuration(
        secondsForBars(
          pace.measures,
          String(pace.tempo),
          GENERATE_SCORE_TIME_SIGNATURE_OPTIONS['4/4']
        )
      )
    );
  });

  it('draws the tempo inside the style range rather than its nominal tempo', () => {
    const top = reduceNewProjectDraft(
      initialNewProjectDraft(),
      { type: 'applyStyle', style: 'pop' },
      () => 0.999
    );
    const [, max] = styleTempoRange('pop')!;
    expect(top.tempoText).toBe(String(max));
  });

  it('adds the singer only while the model writes the music', () => {
    const blank = run([{ type: 'applyStyle', style: 'pop' }]);
    expect(hasVocalInstrument(values(blank))).toBe(false);
    const generated = run([
      { type: 'setGenerating', generating: true },
      { type: 'applyStyle', style: 'pop' },
    ]);
    expect(hasVocalInstrument(values(generated))).toBe(true);
    // The singer the style added is the one the toggle takes back.
    expect(generated.autoVocalId).toBe(
      generated.ensemble.find(entry => hasVocalInstrument([entry.value]))!.id
    );
  });

  it('clearing the style leaves the form alone', () => {
    const styled = run([{ type: 'applyStyle', style: 'pop' }]);
    const cleared = run([{ type: 'applyStyle', style: '' }], styled);
    expect(cleared.style).toBe('');
    expect(cleared.ensemble).toBe(styled.ensemble);
    expect(cleared.tempoText).toBe(styled.tempoText);
  });

  it('an unknown style is recorded and changes nothing else', () => {
    const draft = run([{ type: 'applyStyle', style: 'nonsense' }]);
    expect(draft.style).toBe('nonsense');
    expect(values(draft)).toEqual([DEFAULT_INSTRUMENT_VALUE]);
  });
});

describe('setGenerating', () => {
  it('prepends a singer when the roster has none, and takes that one back', () => {
    const on = run([{ type: 'setGenerating', generating: true }]);
    expect(values(on)).toEqual([
      DEFAULT_VOCAL_INSTRUMENT_VALUE,
      DEFAULT_INSTRUMENT_VALUE,
    ]);
    const off = run([{ type: 'setGenerating', generating: false }], on);
    expect(off.generating).toBe(false);
    expect(values(off)).toEqual([DEFAULT_INSTRUMENT_VALUE]);
    expect(off.autoVocalId).toBeNull();
  });

  it('adds no second singer to a roster that already has one', () => {
    const draft = run([
      { type: 'addInstrument', value: DEFAULT_VOCAL_INSTRUMENT_VALUE },
      { type: 'setGenerating', generating: true },
    ]);
    expect(values(draft)).toEqual([
      DEFAULT_INSTRUMENT_VALUE,
      DEFAULT_VOCAL_INSTRUMENT_VALUE,
    ]);
    // The voice was the reader's, so turning generation off keeps it.
    const off = run([{ type: 'setGenerating', generating: false }], draft);
    expect(values(off)).toEqual(values(draft));
  });

  it('takes back the added singer by id, not the first voice in the list', () => {
    const draft = run([
      { type: 'setGenerating', generating: true },
      // The reader moves their own voice to the top by adding and removing.
      { type: 'addInstrument', value: DEFAULT_VOCAL_INSTRUMENT_VALUE },
    ]);
    const autoId = draft.autoVocalId;
    const off = run([{ type: 'setGenerating', generating: false }], draft);
    expect(off.ensemble.some(entry => entry.id === autoId)).toBe(false);
    expect(values(off)).toEqual([
      DEFAULT_INSTRUMENT_VALUE,
      DEFAULT_VOCAL_INSTRUMENT_VALUE,
    ]);
  });

  it('a singer removed by hand leaves the toggle nothing to take back', () => {
    const on = run([
      { type: 'addInstrument', value: '40' },
      { type: 'setGenerating', generating: true },
    ]);
    const removed = run(
      [{ type: 'removeInstrument', id: on.autoVocalId! }],
      on
    );
    expect(removed.autoVocalId).toBeNull();
    const off = run([{ type: 'setGenerating', generating: false }], removed);
    expect(values(off)).toEqual(values(removed));
  });

  it('never takes the roster below one entry', () => {
    const on = run([
      { type: 'setGenerating', generating: true },
      { type: 'removeInstrument', id: 0 },
    ]);
    expect(values(on)).toEqual([DEFAULT_VOCAL_INSTRUMENT_VALUE]);
    const off = run([{ type: 'setGenerating', generating: false }], on);
    expect(values(off)).toEqual([DEFAULT_VOCAL_INSTRUMENT_VALUE]);
  });
});

describe('instrument rows', () => {
  const styledGenerating = (): NewProjectFormDraft =>
    run([
      { type: 'setGenerating', generating: true },
      { type: 'applyStyle', style: 'pop' },
    ]);

  it('locks the style essentials only while generating with a style', () => {
    const draft = styledGenerating();
    const essential = draft.ensemble.find(entry => entry.tier === 'essential')!;
    const preferred = draft.ensemble.find(entry => entry.tier === 'preferred')!;
    expect(isNewProjectEntryLocked(draft, essential)).toBe(true);
    expect(isNewProjectEntryLocked(draft, preferred)).toBe(false);
    const blank = run([{ type: 'setGenerating', generating: false }], draft);
    expect(isNewProjectEntryLocked(blank, essential)).toBe(false);
    const unstyled = run([{ type: 'applyStyle', style: '' }], draft);
    expect(isNewProjectEntryLocked(unstyled, essential)).toBe(false);
  });

  it('refuses to remove or replace a locked row', () => {
    const draft = styledGenerating();
    const essential = draft.ensemble.find(entry => entry.tier === 'essential')!;
    expect(canRemoveNewProjectEntry(draft, essential)).toBe(false);
    expect(run([{ type: 'removeInstrument', id: essential.id }], draft)).toBe(
      draft
    );
    expect(
      run([{ type: 'replaceInstrument', id: essential.id, value: '40' }], draft)
    ).toBe(draft);
  });

  it('adds with a fresh id, so the same instrument can appear twice', () => {
    const draft = run([
      { type: 'addInstrument', value: '40' },
      { type: 'addInstrument', value: '40' },
    ]);
    expect(draft.ensemble.map(entry => entry.id)).toEqual([0, 1, 2]);
    expect(values(draft)).toEqual([DEFAULT_INSTRUMENT_VALUE, '40', '40']);
    expect(draft.ensemble[1].tier).toBeUndefined();
  });

  it('never removes the last row', () => {
    const draft = initialNewProjectDraft();
    expect(canRemoveNewProjectEntry(draft, draft.ensemble[0])).toBe(false);
    expect(run([{ type: 'removeInstrument', id: 0 }], draft)).toBe(draft);
  });

  it('a replaced row becomes the reader’s: no tier, not the auto singer', () => {
    const on = run([{ type: 'setGenerating', generating: true }]);
    const replaced = run(
      [{ type: 'replaceInstrument', id: on.autoVocalId!, value: '40' }],
      on
    );
    expect(replaced.autoVocalId).toBeNull();
    expect(values(replaced)).toEqual(['40', DEFAULT_INSTRUMENT_VALUE]);
    const styled = styledGenerating();
    const preferred = styled.ensemble.find(
      entry => entry.tier === 'preferred'
    )!;
    const swapped = run(
      [{ type: 'replaceInstrument', id: preferred.id, value: '40' }],
      styled
    );
    expect(swapped.ensemble.find(entry => entry.id === preferred.id)).toEqual({
      id: preferred.id,
      value: '40',
    });
  });
});

describe('length, tempo and meter', () => {
  it('refreshes the duration from bars, tempo and meter', () => {
    const draft = run([
      { type: 'setBars', text: '16' },
      { type: 'setTempo', text: '60' },
      { type: 'setMeter', meter: '3/4' },
    ]);
    expect(draft.durationText).toBe(
      formatDuration(
        secondsForBars(16, '60', GENERATE_SCORE_TIME_SIGNATURE_OPTIONS['3/4'])
      )
    );
  });

  it('keeps the duration text while the bars are not a usable count', () => {
    const before = initialNewProjectDraft();
    const draft = run([{ type: 'setBars', text: '' }], before);
    expect(draft.measuresText).toBe('');
    expect(draft.durationText).toBe(before.durationText);
  });

  it('typing a duration sets the bars and keeps what was typed', () => {
    const draft = run([
      { type: 'setTempo', text: '120' },
      { type: 'setDuration', text: '1:' },
    ]);
    expect(draft.durationText).toBe('1:');
    expect(draft.measuresText).toBe(String(DEFAULT_GENERATE_SCORE_MEASURES));
    const typed = run([{ type: 'setDuration', text: '1:04' }], draft);
    // 64 seconds of 4/4 at 120 is 32 bars.
    expect(typed.measuresText).toBe('32');
    expect(typed.durationText).toBe('1:04');
    expect(newProjectDurationRefused(draft)).toBe(true);
    expect(newProjectDurationRefused(typed)).toBe(false);
  });

  it('tidyDuration rewrites a typed length as what the bars play', () => {
    const draft = run([
      { type: 'setTempo', text: '120' },
      { type: 'setDuration', text: '64' },
      { type: 'tidyDuration' },
    ]);
    expect(draft.durationText).toBe('1:04');
  });

  it('refuses a tempo that is typed and not positive, and allows blank', () => {
    expect(newProjectTempoRefused(initialNewProjectDraft())).toBe(false);
    expect(newProjectTempoRefused(run([{ type: 'setTempo', text: ' ' }]))).toBe(
      false
    );
    expect(newProjectTempoRefused(run([{ type: 'setTempo', text: '0' }]))).toBe(
      true
    );
    expect(
      newProjectTempoRefused(run([{ type: 'setTempo', text: 'fast' }]))
    ).toBe(true);
    expect(
      newProjectTempoRefused(run([{ type: 'setTempo', text: '90' }]))
    ).toBe(false);
  });
});

describe('what the form shows', () => {
  it('names the default title by mode', () => {
    expect(newProjectDefaultTitleKey(initialNewProjectDraft())).toBe(
      'newProject.defaultTitle'
    );
    expect(
      newProjectDefaultTitleKey(
        run([{ type: 'setGenerating', generating: true }])
      )
    ).toBe('newProject.defaultTitleGenerated');
  });

  it('keeps duration available while words are being written', () => {
    expect(showNewProjectDuration(initialNewProjectDraft())).toBe(true);
    const song = run([{ type: 'setGenerating', generating: true }]);
    expect(showNewProjectDuration(song)).toBe(true);
    expect(
      showNewProjectDuration(run([{ type: 'setLyrics', lyrics: false }], song))
    ).toBe(true);
    const instrumental = run(
      [{ type: 'removeInstrument', id: song.autoVocalId! }],
      song
    );
    expect(showNewProjectDuration(instrumental)).toBe(true);
    // A voice in a blank project writes no words, so the clock stays.
    const blankWithVoice = run([
      { type: 'addInstrument', value: DEFAULT_VOCAL_INSTRUMENT_VALUE },
    ]);
    expect(showNewProjectDuration(blankWithVoice)).toBe(true);
  });

  it('keeps the selected duration stable when tempo changes', () => {
    const draft = run([
      { type: 'setTempo', text: '120' },
      { type: 'setDuration', text: '0:30' },
      { type: 'setTempo', text: '60' },
    ]);
    expect(draft.durationText).toBe('0:30');
    expect(draft.measuresText).toBe('8');
    expect(draft.lengthSource).toBe('duration');
  });

  it('offers the lyrics switch only over a singer, and the theme only with it on', () => {
    expect(showNewProjectLyrics(initialNewProjectDraft())).toBe(false);
    const song = run([{ type: 'setGenerating', generating: true }]);
    expect(showNewProjectLyrics(song)).toBe(true);
    expect(showNewProjectLyricsTheme(song)).toBe(true);
    expect(
      showNewProjectLyricsTheme(
        run([{ type: 'setLyrics', lyrics: false }], song)
      )
    ).toBe(false);
  });

  it('quotes bars times instruments', () => {
    const draft = run([
      { type: 'setBars', text: '12' },
      { type: 'addInstrument', value: '40' },
    ]);
    expect(newProjectCreditEstimate(draft)).toBe(24);
    expect(
      newProjectCreditEstimate(run([{ type: 'setBars', text: 'x' }]))
    ).toBe(0);
  });
});

describe('canCreateNewProject', () => {
  const ready = { submitting: false, outOfCredits: false };

  it('a blank project needs only a usable length, roster and tempo', () => {
    expect(canCreateNewProject(initialNewProjectDraft(), ready)).toBe(true);
    expect(
      canCreateNewProject(run([{ type: 'setBars', text: '0' }]), ready)
    ).toBe(false);
    expect(
      canCreateNewProject(run([{ type: 'setTempo', text: '-1' }]), ready)
    ).toBe(false);
  });

  it('a blank project is never gated on credits', () => {
    expect(
      canCreateNewProject(initialNewProjectDraft(), {
        submitting: false,
        outOfCredits: true,
      })
    ).toBe(true);
  });

  it('generation needs a prompt and credits', () => {
    const on = run([{ type: 'setGenerating', generating: true }]);
    expect(canCreateNewProject(on, ready)).toBe(false);
    const prompted = run([{ type: 'setPrompt', prompt: 'a song' }], on);
    expect(canCreateNewProject(prompted, ready)).toBe(true);
    expect(
      canCreateNewProject(prompted, { submitting: false, outOfCredits: true })
    ).toBe(false);
  });

  it('nothing is created twice while submitting', () => {
    expect(
      canCreateNewProject(initialNewProjectDraft(), {
        submitting: true,
        outOfCredits: false,
      })
    ).toBe(false);
  });
});

describe('newProjectSubmission', () => {
  it('a blank project carries the default title as its name, not the score’s', () => {
    const submission = newProjectSubmission(
      initialNewProjectDraft(),
      'New Score'
    );
    expect(submission?.kind).toBe('blank');
    if (submission?.kind !== 'blank') return;
    expect(submission.title).toBe('New Score');
    expect(submission.score.metadata.title).toBe('Untitled');
    expect(submission.score.tracks).toHaveLength(1);
  });

  it('a typed title names both', () => {
    const draft = run([{ type: 'setTitle', title: '  Waltz  ' }]);
    const submission = newProjectSubmission(draft, 'New Score');
    if (submission?.kind !== 'blank') throw new Error('expected blank');
    expect(submission.title).toBe('Waltz');
    expect(submission.score.metadata.title).toBe('Waltz');
  });

  it('generation sends the request with the default title and the variant', () => {
    const draft = run([
      { type: 'setGenerating', generating: true },
      { type: 'setPrompt', prompt: 'a song about home' },
      { type: 'setMood', mood: 'calm' },
      { type: 'setComplexity', complexity: 'simple' },
      { type: 'setLyricsTheme', lyricsTheme: 'rain' },
      { type: 'setKey', fifths: 2 },
      { type: 'setMode', mode: 'minor' },
    ]);
    const submission = newProjectSubmission(draft, 'Generated Score');
    if (submission?.kind !== 'generate') throw new Error('expected generate');
    expect(submission.request).toMatchObject({
      prompt: 'a song about home',
      title: 'Generated Score',
      mood: 'calm',
      complexity: 'simple',
      lyrics: true,
      lyricsTheme: 'rain',
      keySignature: { fifths: 2, mode: 'minor' },
      variant: 'deepseek',
      durationMeasures: DEFAULT_GENERATE_SCORE_MEASURES,
    });
    expect(submission.request.tracks).toHaveLength(2);
  });

  it('the default variant is left off the wire', () => {
    const draft = run([
      { type: 'setGenerating', generating: true },
      { type: 'setPrompt', prompt: 'x' },
      { type: 'setVariant', variant: 'default' },
    ]);
    const submission = newProjectSubmission(draft, 'Generated Score');
    if (submission?.kind !== 'generate') throw new Error('expected generate');
    expect(submission.request.variant).toBeUndefined();
  });

  it('null when the builder would refuse', () => {
    const draft = run([{ type: 'setGenerating', generating: true }]);
    expect(newProjectSubmission(draft, 'Generated Score')).toBeNull();
  });

  it('the request draft omits an empty style and mood', () => {
    const request = newProjectRequestDraft(initialNewProjectDraft());
    expect(request.style).toBeFalsy();
    expect(request.mood).toBeFalsy();
    expect(request.timeSignature).toEqual(
      GENERATE_SCORE_TIME_SIGNATURE_OPTIONS['4/4']
    );
  });
});

describe('plain setters', () => {
  it('each sets its one field', () => {
    const draft = run([
      { type: 'setPrompt', prompt: 'p' },
      { type: 'setMood', mood: 'dark' },
      { type: 'setLyrics', lyrics: false },
      { type: 'setVariant', variant: 'local' },
    ]);
    expect(draft).toMatchObject({
      prompt: 'p',
      mood: 'dark',
      lyrics: false,
      variant: 'local',
    });
  });
});
