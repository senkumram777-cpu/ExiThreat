/**
 * Reads what the author's group map needs (groupMap.ts) for one post.
 */

import { prisma } from '../index';
import { groupMinMembers } from './groupService';
import { GroupMap, buildGroupMap } from './groupMap';

export async function groupMapFor(post: { id: string; ocUserId: string }): Promise<GroupMap> {
  const [groups, counts, authorGroups, history, placements, cycle] = await Promise.all([
    prisma.group.findMany({ select: { id: true, name: true, trustScore: true } }),
    prisma.groupMember.groupBy({ by: ['groupId'], _count: { _all: true } }),
    prisma.groupMember.findMany({ where: { userId: post.ocUserId }, select: { groupId: true } }),
    prisma.postHistory.findMany({
      where: { postId: post.id },
      select: { groupId: true, arrivedBy: true, fromGroupId: true, arrivedAt: true },
    }),
    prisma.postPlacement.findMany({
      where: { postId: post.id },
      select: { groupId: true, arrivedBy: true, fromGroupId: true, arrivedAt: true },
    }),
    prisma.post.findUniqueOrThrow({ where: { id: post.id }, select: { cycle: true, cycleStartedAt: true, createdAt: true } }),
  ]);

  const sizes = new Map(counts.map((c) => [c.groupId, c._count._all]));
  const authorIn = new Set(authorGroups.map((m) => m.groupId));

  return buildGroupMap(
    groups.map((g) => ({
      id: g.id,
      name: g.name,
      weight: g.trustScore,
      own: authorIn.has(g.id),
      eligible: (sizes.get(g.id) ?? 0) >= groupMinMembers() && !authorIn.has(g.id),
    })),
    [
      ...history.map((a) => ({ ...a, current: false })),
      ...placements.map((a) => ({ ...a, current: true })),
    ],
    cycle.cycle,
    cycle.cycleStartedAt ?? cycle.createdAt,
  );
}
