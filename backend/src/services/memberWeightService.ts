/**
 * Keeps each member's own weightage (User.weight, with activityScore, postScore and
 * voteScore) up to date. The formula is in memberWeight.ts. Recalculated for everyone by the
 * hourly sweep, and for one member whenever they open their account page.
 */

import { prisma } from '../index';
import { WINDOW_DAYS, indiaDay } from './groupWeight';
import { MemberWeight, memberWeightOf } from './memberWeight';
import { DAY_MS, possibleDaysSince, reviewCounts } from './groupWeightService';

export interface MemberWeightResult extends MemberWeight {
  activeDays: number;
  minutes: number;
  posts: number;
  reviewed: number;
  due: number;
  windowDays: number;
}

export async function recalculateMemberWeight(userId: string): Promise<MemberWeightResult> {
  const now = Date.now();
  const windowStart = now - WINDOW_DAYS * DAY_MS;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { createdAt: true, groupMemberships: { select: { groupId: true, joinedAt: true } } },
  });

  const [days, posts, ...perGroup] = await Promise.all([
    prisma.userActiveDay.findMany({
      where: { userId, day: { gte: indiaDay(new Date(windowStart)) } },
      select: { seconds: true },
    }),
    prisma.post.count({ where: { ocUserId: userId, createdAt: { gte: new Date(windowStart) } } }),
    ...user.groupMemberships.map((m) =>
      reviewCounts(m.groupId, [{ userId, joinedAt: m.joinedAt }], windowStart, now)),
  ]);
  let reviewed = 0;
  let due = 0;
  for (const counts of perGroup) {
    const c = counts.get(userId);
    reviewed += c?.reviewed ?? 0;
    due += c?.due ?? 0;
  }

  const usage = {
    possibleDays: possibleDaysSince(user.createdAt.getTime(), windowStart, now),
    activeDays: days.length,
    seconds: days.reduce((sum, d) => sum + d.seconds, 0),
    posts,
    reviewed,
    due,
  };
  const result = memberWeightOf(usage);
  await prisma.user.update({
    where: { id: userId },
    data: {
      weight: result.weight,
      activityScore: result.activityScore,
      postScore: result.postScore,
      voteScore: result.voteScore,
      weightUpdatedAt: new Date(now),
    },
  });
  return {
    ...result,
    activeDays: usage.activeDays,
    minutes: Math.round(usage.seconds / 60),
    posts,
    reviewed,
    due,
    windowDays: usage.possibleDays,
  };
}

/** Every member, one after another. Never throws. */
export async function recalculateAllMemberWeights(): Promise<void> {
  try {
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const u of users) await recalculateMemberWeight(u.id);
  } catch (err) {
    console.error('Member weight recalculation failed:', err);
  }
}
