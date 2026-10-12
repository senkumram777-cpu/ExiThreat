/**
 * The weight of a post, worked out from its history in the order it happened.
 *
 * It is the sum of the push percentages from the groups the post left by vote. Manual pushes
 * by the author carry nothing. A group counts once, with at most 100: if a post comes back
 * to a group it has already been through, only the first vote counts, so a post cannot gain
 * weight by going round the same groups.
 */

export interface HistoryEntry {
  groupId: string;
  pushPercentage: number;
  wasManualPush: boolean;
}

export function weightOf(history: HistoryEntry[]): number {
  const counted = new Set<string>();
  let total = 0;
  for (const h of history) {
    if (h.wasManualPush || counted.has(h.groupId)) continue;
    counted.add(h.groupId);
    total += Math.min(h.pushPercentage, 100);
  }
  return total;
}
