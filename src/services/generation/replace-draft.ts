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
 * `ReplaceSubmission`, `ReplaceDraft` and the preset keys are vocabulary, in
 * music_types; `prepareReplacement`, which turns a submission into a request,
 * is music_editing's. This module only builds one from a form.
 */
import type {
  ReplaceDraft,
  ReplacePresetKey,
  ReplaceSubmission,
} from '@sudobility/music_types';
import { DEFAULT_GENERATION_VARIANT } from './new-project-draft.js';

/** The locale key holding a preset instruction's text. */
export function replacePresetLabelKey(key: ReplacePresetKey): string {
  return `replace.preset.${key}`;
}

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
