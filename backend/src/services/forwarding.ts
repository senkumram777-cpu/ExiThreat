/**
 * Where a pushed post goes, and how far. Pure functions, no database, so the unit tests can
 * load them; groupService.ts applies them.
 *
 * A push forwards the post to several groups at once. The more weight the pusher has, the more
 * groups it reaches (`reachFor`): the group's weight when its members vote it on, the
 * author's own weightage when they push it themselves. A post is never in more than
 * a set number of groups at the same time (5 unless an admin changed it, rules.ts).
 *
 * At least one destination is better weighted than the pusher (`chooseDestinations`): a group
 * whose weight is higher than the pushing group's, or for the author's push, than the best
 * group the post is in now. If there is no such group, the best-weighted group available is
 * taken instead. The others are chosen at random.
 *
 * The post goes round the eligible groups in cycles (`chooseInCycle`): it is sent only to
 * groups it has not reached in the current cycle. Once every eligible group has had it, a new
 * cycle starts and all of them are open to it again.
 */

/** Weight (0 to 1) from which a push reaches 2, and 3, groups. */
export const REACH_STEPS = [0.4, 0.7];

/** How many groups a push by someone with this weight reaches: 1, 2 or 3. */
export function reachFor(weight: number): number {
  return 1 + REACH_STEPS.filter((step) => weight >= step).length;
}

export interface Candidate {
  id: string;
  /** The group's weight, 0 to 1. */
  weight: number;
  /** The post has been in this group before. */
  visited: boolean;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Unvisited groups first, each part in random order. */
function freshFirst(candidates: Candidate[], random: () => number): Candidate[] {
  return [
    ...shuffled(candidates.filter((c) => !c.visited), random),
    ...shuffled(candidates.filter((c) => c.visited), random),
  ];
}

/**
 * Up to `count` destinations from `candidates` (which already leave out the groups the post is
 * in, the author's groups and groups too small to take it). The first one is better weighted
 * than `pusherWeight` when such a group exists, otherwise the best-weighted one.
 */
export function chooseDestinations(
  candidates: Candidate[],
  count: number,
  pusherWeight: number,
  random: () => number = Math.random,
): string[] {
  if (count <= 0 || candidates.length === 0) return [];

  const better = candidates.filter((c) => c.weight > pusherWeight);
  let first: Candidate;
  if (better.length > 0) {
    first = freshFirst(better, random)[0];
  } else {
    const best = Math.max(...candidates.map((c) => c.weight));
    first = freshFirst(candidates.filter((c) => c.weight === best), random)[0];
  }

  const rest = freshFirst(candidates.filter((c) => c.id !== first.id), random);
  return [first.id, ...rest.slice(0, count - 1).map((c) => c.id)];
}

/**
 * Destinations for one push, going round in cycles. `candidates` marks as `visited` the groups
 * reached in the current cycle. Groups not yet reached in it are taken first, with the
 * better-weighted rule applied among them; if they are fewer than `count` (all eligible groups
 * have had the post), a new cycle starts and the rest come from the groups reached before.
 */
export function chooseInCycle(
  candidates: Candidate[],
  count: number,
  pusherWeight: number,
  random: () => number = Math.random,
): { destinations: string[]; newCycle: boolean } {
  const fresh = candidates.filter((c) => !c.visited);
  const first = chooseDestinations(fresh, count, pusherWeight, random);
  if (first.length >= count || first.length === candidates.length) {
    return { destinations: first, newCycle: false };
  }
  // The cycle is complete: the groups it has already been to are open again.
  const again = candidates.filter((c) => c.visited).map((c) => ({ ...c, visited: false }));
  const rest = chooseDestinations(again, count - first.length, first.length === 0 ? pusherWeight : -Infinity, random);
  return { destinations: [...first, ...rest], newCycle: true };
}
