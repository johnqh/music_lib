import { describe, expect, it } from 'vitest';
import type {
  NewProjectDraftAction,
  NewProjectFormDraft,
} from '@sudobility/music_types';
import {
  initialNewProjectDraft,
  newProjectCreditEstimate,
  reduceNewProjectDraft,
} from './new-project-draft';
import {
  NEW_PROJECT_CREDIT_MESSAGE_KEYS,
  newProjectCreditState,
  type NewProjectAccountState,
} from './new-project-credits';

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

const blank = initialNewProjectDraft();
const generating = run([
  { type: 'setGenerating', generating: true },
  { type: 'setPrompt', prompt: 'a song' },
]);
const estimate = newProjectCreditEstimate(generating);

const account = (
  over: Partial<NewProjectAccountState> = {}
): NewProjectAccountState => ({
  signedIn: true,
  balance: 1000,
  siteAdmin: false,
  submitting: false,
  ...over,
});

describe('newProjectCreditState: the Generate switch', () => {
  it('is available to a signed-in reader with credits', () => {
    const state = newProjectCreditState(generating, account());
    expect(state.generationBlock).toBeNull();
    expect(state.generationAvailable).toBe(true);
    expect(state.generating).toBe(true);
  });

  it('is off-limits signed out, or with no server', () => {
    expect(
      newProjectCreditState(blank, account({ signedIn: false })).generationBlock
    ).toBe('signedOut');
    expect(
      newProjectCreditState(blank, account({ serverAvailable: false }))
        .generationBlock
    ).toBe('noServer');
  });

  it('is off-limits below zero, but not at zero', () => {
    expect(
      newProjectCreditState(blank, account({ balance: -1 })).generationBlock
    ).toBe('negativeBalance');
    expect(
      newProjectCreditState(blank, account({ balance: 0 })).generationBlock
    ).toBeNull();
  });

  it('never stands aside for a site administrator, or an unknown balance', () => {
    expect(
      newProjectCreditState(blank, account({ balance: -50, siteAdmin: true }))
        .generationAvailable
    ).toBe(true);
    expect(
      newProjectCreditState(blank, account({ balance: null }))
        .generationAvailable
    ).toBe(true);
  });

  it('stops counting a draft left switched on once unavailable', () => {
    const state = newProjectCreditState(generating, account({ balance: -1 }));
    expect(state.generating).toBe(false);
    expect(state.estimate).toBe(0);
    expect(state.messageKey).toBe(
      NEW_PROJECT_CREDIT_MESSAGE_KEYS.negativeBalance
    );
  });
});

describe('newProjectCreditState: Create', () => {
  it('quotes bars × tracks and offers Create when the balance covers it', () => {
    expect(estimate).toBeGreaterThan(0);
    const state = newProjectCreditState(
      generating,
      account({ balance: estimate })
    );
    expect(state.estimate).toBe(estimate);
    expect(state.balanceAfter).toBe(0);
    expect(state.createBlock).toBeNull();
    expect(state.canCreate).toBe(true);
    expect(state.messageKey).toBeNull();
  });

  it('refuses when balance − estimate goes below zero, and says by how much', () => {
    const state = newProjectCreditState(
      generating,
      account({ balance: estimate - 3 })
    );
    expect(state.createBlock).toBe('insufficientCredits');
    expect(state.canCreate).toBe(false);
    expect(state.messageKey).toBe(
      NEW_PROJECT_CREDIT_MESSAGE_KEYS.insufficientCredits
    );
    expect(state.messageValues).toEqual({
      estimate,
      balance: estimate - 3,
      shortfall: 3,
    });
  });

  it('never refuses a site administrator, or while the balance is unknown', () => {
    expect(
      newProjectCreditState(
        generating,
        account({ balance: 0, siteAdmin: true })
      ).canCreate
    ).toBe(true);
    expect(
      newProjectCreditState(generating, account({ balance: undefined }))
        .canCreate
    ).toBe(true);
  });

  it('never refuses a blank project for credits', () => {
    const state = newProjectCreditState(blank, account({ balance: -10 }));
    expect(state.createBlock).toBeNull();
    expect(state.canCreate).toBe(true);
  });

  it('still needs a buildable request in each mode', () => {
    expect(
      newProjectCreditState(run([{ type: 'setBars', text: '0' }]), account())
        .canCreate
    ).toBe(false);
    const unprompted = run([{ type: 'setGenerating', generating: true }]);
    expect(newProjectCreditState(unprompted, account()).canCreate).toBe(false);
  });

  it('creates nothing twice while submitting', () => {
    expect(
      newProjectCreditState(blank, account({ submitting: true })).canCreate
    ).toBe(false);
  });
});
