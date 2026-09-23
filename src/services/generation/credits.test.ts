import { describe, expect, it } from 'vitest';
import { isOutOfCredits } from './credits';

describe('isOutOfCredits', () => {
  it('gates at a balance of zero or below', () => {
    expect(isOutOfCredits(0, false)).toBe(true);
    expect(isOutOfCredits(-3, false)).toBe(true);
  });

  it('does not gate a positive balance, even one below the estimate', () => {
    expect(isOutOfCredits(1, false)).toBe(false);
  });

  it('does not gate while the balance is unknown', () => {
    expect(isOutOfCredits(null, false)).toBe(false);
    expect(isOutOfCredits(undefined, false)).toBe(false);
  });

  it('never gates a site administrator, who generates for free', () => {
    expect(isOutOfCredits(0, true)).toBe(false);
  });
});
