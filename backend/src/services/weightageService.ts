/**
 * Weightage Service
 *
 * The "Current Weightage" of a post is the sum of push percentages from
 * every group it has successfully traversed (stored in PostHistory).
 *
 * Manual OC pushes record wasManualPush=true and carry 0 weightage. A group counts once:
 * if a post comes back to a group it has already been through, only the first vote counts,
 * so a post cannot gain weight by going round the same groups.
 */

import { prisma } from '../index';
import { weightOf } from './weight';

export interface WeightageResult {
  postId: string;
  aggregatedWeight: number;
  groupsTraversed: number;
  history: Array<{
    groupId: string;
    groupName: string;
    pushPercentage: number;
    movedAt: Date;
    wasManualPush: boolean;
  }>;
}

export async function getPostWeightage(postId: string): Promise<WeightageResult | null> {
  const history = await prisma.postHistory.findMany({
    where: { postId },
    include: { group: { select: { name: true } } },
    orderBy: { movedAt: 'asc' },
  });

  if (history.length === 0) {
    const exists = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!exists) return null;
  }

  const aggregatedWeight = weightOf(history);

  return {
    postId,
    aggregatedWeight,
    groupsTraversed: history.length,
    history: history.map((h) => ({
      groupId: h.groupId,
      groupName: h.group.name,
      pushPercentage: h.pushPercentage,
      movedAt: h.movedAt,
      wasManualPush: h.wasManualPush,
    })),
  };
}

/**
 * Recomputes and persists Post.totalWeight from PostHistory.
 * Called after every move.
 */
export async function recalculateTotalWeight(postId: string): Promise<number> {
  const history = await prisma.postHistory.findMany({
    where: { postId },
    orderBy: { movedAt: 'asc' },
    select: { groupId: true, pushPercentage: true, wasManualPush: true },
  });
  const total = weightOf(history);
  await prisma.post.update({ where: { id: postId }, data: { totalWeight: total } });
  return total;
}
