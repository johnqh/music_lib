/**
 * What the Replace form holds, what it opens with, and what it submits.
 *
 * The two apps' Replace forms had parted on every default: the web opened on
 * `moderate` complexity with nothing preserved and a model picker, native on
 * "keep complexity" with boundary notes preserved and no model picker at all —
 * so the same instruction over the same bars sent two different requests
 * depending on which device asked. It also offered half the preset list. The
 * web's values are the reference, and they now live here.
 *
 * `ReplaceSubmission` itself stays in music_editing beside
 * `prepareReplacement`, which turns it into a request; this module only builds
 * one from a form.
 */
import type { ReplaceSubmission } from '@sudobility/music_editing';
import type { GenerateScoreComplexity } from './request.js';
import { DEFAULT_GENERATION_VARIANT } from './new-project-draft.js';

/**
 * The preset instructions, as spec §12 lists them — by key.
 *
 * Choosing one fills the instruction field with its text in the reader's
 * language, which is then what the model is asked. The same model as New
 * Project's briefs (`generateScore.preset.<key>`), and for the same reason: the
 * model reads Chinese as well as English, and a Chinese reader handed fourteen
 * English sentences to choose from is prompting in a language the rest of the
 * form is not in. They were English literals in both apps until now, so the
 * words move into each app's locale under `replace.preset.<key>`, and the list
 * of which presets exist is stated here once.
 *
 * English, for the locale files: moreDramatic "Make this more dramatic",
 * simplify "Simplify this passage", rhythmicVariation "Add rhythmic
 * variation", memorableMelody "Make the melody more memorable",
 * strongerTransition "Create a stronger transition", harmonicTension "Add
 * harmonic tension", resolvePhrase "Resolve the phrase", moreUpbeat "Make this
 * more upbeat", darker "Make this darker", variationKeepMelody "Create a
 * variation while preserving the melody", keepRhythmChangeHarmony "Preserve
 * rhythm but change harmony", keepHarmonyChangeMelody "Preserve harmony but
 * change melody", addAccompaniment "Add accompaniment", thinOrchestration "Thin
 * out the orchestration".
 */
export const REPLACE_PRESET_KEYS = [
  'moreDramatic',
  'simplify',
  'rhythmicVariation',
  'memorableMelody',
  'strongerTransition',
  'harmonicTension',
  'resolvePhrase',
  'moreUpbeat',
  'darker',
  'variationKeepMelody',
  'keepRhythmChangeHarmony',
  'keepHarmonyChangeMelody',
  'addAccompaniment',
  'thinOrchestration',
] as const;

export type ReplacePresetKey = (typeof REPLACE_PRESET_KEYS)[number];

/** The locale key holding a preset instruction's text. */
export function replacePresetLabelKey(key: ReplacePresetKey): string {
  return `replace.preset.${key}`;
}

/**
 * The Replace form's state. `style` and `mood` use `''` for "none", as the New
 * Project draft does; the submission omits them, which is what "no particular
 * style" means on the wire.
 */
export type ReplaceDraft = {
  instruction: string;
  style: string;
  mood: string;
  complexity: GenerateScoreComplexity;
  variant: string;
  constraints: ReplaceSubmission['constraints'];
};

/**
 * A fresh Replace form.
 *
 * Nothing preserved by default, including boundary notes: each constraint
 * removes a dimension the model was asked to work in, and the reader opting in
 * is clearer than discovering one was on. A new object each call, so a form
 * resetting per opening — which both do, since an instruction written for one
 * selection silently applies to the next otherwise — cannot share state with
 * the last one.
 */
export function defaultReplaceSubmission(): ReplaceDraft {
  return {
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
  };
}

/**
 * The submission a form asks for, or `null` while the instruction is blank —
 * which is also the form's rule for disabling Replace, so the two cannot
 * disagree.
 */
export function buildReplaceSubmission(
  draft: ReplaceDraft
): ReplaceSubmission | null {
  const instruction = draft.instruction.trim();
  if (instruction === '') return null;
  return {
    instruction,
    ...(draft.style ? { style: draft.style } : {}),
    ...(draft.mood ? { mood: draft.mood } : {}),
    complexity: draft.complexity,
    variant: draft.variant,
    constraints: { ...draft.constraints },
  };
}
