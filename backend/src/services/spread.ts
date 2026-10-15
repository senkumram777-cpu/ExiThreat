/**
 * A post's spread, which decides whether and where it appears on the common page. Pure, so
 * the unit tests can load it; spreadService.ts gathers the numbers and stores them.
 *
 * - Share: of the groups that could take the post now (enough members, the author not in
 *   them), the part it has been in, however it got there (a group's votes or its author).
 * - Listed: the first time the share reaches LIST_SHARE (20%), the post goes on the common
 *   page, and stays there.
 * - Spread score: the share per day since it was posted. Before 20% that is how fast it is
 *   getting there; afterwards it keeps rising while the post spreads quickly and falls as it
 *   slows or ages. The common page is ordered by it, highest first.
 */

export const LIST_SHARE = 0.2;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ages under an hour count as an hour, so that a brand-new post does not score without limit. */
const MIN_AGE_MS = 60 * 60 * 1000;

export function shareOf(reached: number, eligible: number): number {
  if (eligible <= 0) return 0;
  return Math.min(1, Math.max(0, reached) / eligible);
}

/** Share of the eligible groups reached per day since the post was written. */
export function spreadScoreOf(share: number, ageMs: number): number {
  return share / (Math.max(ageMs, MIN_AGE_MS) / DAY_MS);
}

export function reachesList(share: number): boolean {
  return share >= LIST_SHARE;
}
