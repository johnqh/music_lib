/**
 * What New Project's credit rules allow, and what to say about it.
 *
 * Both apps draw the same two controls from this one answer — the "Generate for
 * me" switch and Create — so neither decides anything about credits itself:
 *
 * 1. **The switch is off-limits** without an account (generation writes into a
 *    server project), without a server at all, or with a balance **below zero**
 *    for anybody but a site administrator, whom the server charges nothing.
 * 2. **Create is refused** while generating when the balance would go below
 *    zero once the estimate is spent — `balance − estimate < 0` — again for
 *    anybody but a site administrator. A blank project costs nothing and is
 *    never refused for credits.
 *
 * A balance not yet known (still loading, or the request failed) refuses
 * nothing: the server answers 402 on its own, and a form that froze until the
 * balance arrived would refuse work it has no reason to.
 *
 * **Words are keys**, as everywhere in this module: `messageKey` names a locale
 * entry each app supplies, and `messageValues` fills it.
 */
import {
  canBuildGenerateScoreRequest,
  canBuildNewProjectScore,
} from './request';
import type { NewProjectFormDraft } from '@sudobility/music_types';
import {
  newProjectCreditEstimate,
  newProjectRequestDraft,
} from './new-project-draft';

/** Why "Generate for me" cannot be switched on. */
export type NewProjectGenerationBlock =
  /** No account: generation writes into a server project. */
  | 'signedOut'
  /** No server to generate on (a local-only build or session). */
  | 'noServer'
  /** The balance is below zero. */
  | 'negativeBalance';

/** Why Create is refused. */
export type NewProjectCreateBlock =
  /** Spending the estimate would take the balance below zero. */
  'insufficientCredits';

/** The locale key each block is explained by, in both apps. */
export const NEW_PROJECT_CREDIT_MESSAGE_KEYS: Record<
  NewProjectGenerationBlock | NewProjectCreateBlock,
  string
> = {
  signedOut: 'newProject.generationNeedsSignIn',
  noServer: 'newProject.generationNeedsServer',
  negativeBalance: 'newProject.generationNeedsCredits',
  insufficientCredits: 'newProject.notEnoughCredits',
};

export interface NewProjectAccountState {
  /** Somebody is signed in. */
  signedIn: boolean;
  /** There is a server to generate on. Defaults to true. */
  serverAvailable?: boolean;
  /** The credit balance, or null/undefined while it is not known. */
  balance: number | null | undefined;
  /** Site administrators are charged nothing and never gated. */
  siteAdmin: boolean;
  /** A create is already in flight. */
  submitting: boolean;
}

export interface NewProjectCreditState {
  /** Why the switch is disabled, or null when it may be used. */
  generationBlock: NewProjectGenerationBlock | null;
  /** Whether the switch may be used. */
  generationAvailable: boolean;
  /**
   * Whether the form is generating: the draft asks to, and the switch is
   * available. A draft left switched on stops counting the moment the switch
   * becomes unavailable.
   */
  generating: boolean;
  /** Credits the generation is quoted at (bars × tracks); 0 when not generating. */
  estimate: number;
  /** The balance after spending the estimate, or null when the balance is unknown. */
  balanceAfter: number | null;
  /** Why Create is refused for credits, or null. */
  createBlock: NewProjectCreateBlock | null;
  /** Whether Create is offered. */
  canCreate: boolean;
  /** The locale key explaining whichever block applies, or null for none. */
  messageKey: string | null;
  /** Values for `messageKey`: `estimate`, `balance`, `shortfall`. */
  messageValues: { estimate: number; balance: number; shortfall: number };
}

/** Whether a balance is known. */
function known(balance: number | null | undefined): balance is number {
  return typeof balance === 'number' && Number.isFinite(balance);
}

/**
 * Everything New Project's switch, Create button and explanation need. See the
 * module comment for the rules.
 */
export function newProjectCreditState(
  draft: NewProjectFormDraft,
  account: NewProjectAccountState
): NewProjectCreditState {
  const {
    signedIn,
    serverAvailable = true,
    balance,
    siteAdmin,
    submitting,
  } = account;

  const generationBlock: NewProjectGenerationBlock | null = !serverAvailable
    ? 'noServer'
    : !signedIn
      ? 'signedOut'
      : !siteAdmin && known(balance) && balance < 0
        ? 'negativeBalance'
        : null;
  const generationAvailable = generationBlock === null;
  const generating = draft.generating && generationAvailable;

  const estimate = generating ? newProjectCreditEstimate(draft) : 0;
  const balanceAfter = known(balance) ? balance - estimate : null;
  const createBlock: NewProjectCreateBlock | null =
    generating && !siteAdmin && balanceAfter !== null && balanceAfter < 0
      ? 'insufficientCredits'
      : null;

  const request = newProjectRequestDraft(draft);
  const canCreate =
    !submitting &&
    (generating
      ? createBlock === null && canBuildGenerateScoreRequest(request)
      : canBuildNewProjectScore(request));

  // Create's refusal is the more pressing of the two: it is the one in the
  // way of the button somebody is about to press.
  const block = createBlock ?? generationBlock;
  return {
    generationBlock,
    generationAvailable,
    generating,
    estimate,
    balanceAfter,
    createBlock,
    canCreate,
    messageKey: block ? NEW_PROJECT_CREDIT_MESSAGE_KEYS[block] : null,
    messageValues: {
      estimate,
      balance: known(balance) ? balance : 0,
      shortfall: balanceAfter !== null && balanceAfter < 0 ? -balanceAfter : 0,
    },
  };
}
