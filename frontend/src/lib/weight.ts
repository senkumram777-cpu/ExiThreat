/**
 * Plain-language forms of a post's numbers. A post's weight is the sum of the vote shares (0 to
 * 100 each) of the groups it left by vote, so 100 is one whole group's backing; the spread
 * score is the share of the eligible groups reached per day.
 */

function trim(n: number): string {
  return n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, '');
}

/** "Backed by 2.3 groups", "Backed by 40% of a group", or "Not pushed yet". */
export function backedBy(totalWeight: number): string {
  if (totalWeight <= 0) return 'Not pushed yet';
  if (totalWeight < 100) return `Backed by ${Math.round(totalWeight)}% of a group`;
  const groups = totalWeight / 100;
  return `Backed by ${trim(groups)} group${groups === 1 ? '' : 's'}`;
}

/** A group's vote share, as a whole percentage. */
export function voteShare(pushPercentage: number): string {
  return `${Math.round(pushPercentage)}%`;
}

/** "≈ 4.2 groups a day": the spread score in groups rather than as a share. */
export function groupsPerDay(spreadScore: number, eligibleGroups: number): string {
  const n = spreadScore * eligibleGroups;
  if (n <= 0) return '0 groups a day';
  if (n < 0.1) return '< 0.1 groups a day';
  return `≈ ${trim(n)} group${n === 1 ? '' : 's'} a day`;
}
