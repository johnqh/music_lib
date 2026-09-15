/**
 * Whether the generate controls stand aside for want of credits.
 *
 * Here beside the credit estimates (`estimateGenerateScoreCredits` and its
 * siblings in `request.ts`) rather than in music_types, where it first landed:
 * a balance is a fact about the reader's account, which the backend never asks
 * this question about — it answers 402 on its own — so it is frontend business
 * logic, not a primitive both sides need.
 *
 * A courtesy gate, not the rule, so it is deliberately lax. It gates at a
 * balance of **zero or below only**, not when an estimate exceeds the balance:
 * a job may overdraw once by design, and a stricter check would refuse work the
 * server accepts. An unknown balance (still loading, or the request failed)
 * does not gate, and a site administrator never does, since the server
 * generates for them for free. Both apps had this expression inline.
 */
export function isOutOfCredits(
  balance: number | null | undefined,
  siteAdmin: boolean
): boolean {
  if (siteAdmin) return false;
  return balance !== null && balance !== undefined && balance <= 0;
}
