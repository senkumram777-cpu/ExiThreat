/**
 * Keeps each group's weight (Group.trustScore, with loginScore and reviewScore) up to date.
 * The formula is in groupWeight.ts. Recalculated for every group by the hourly sweep, and
 * for one group when a member of it finishes going through a post.
 */

import { prisma } from '../index';
import {
  MemberActivity,
  REVIEW_GRACE_MS,
  WINDOW_DAYS,
  groupWeightOf,
  indiaDay,
} from './groupWeight';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Active days are kept a little longer than they are counted, then removed. */
const KEEP_DAYS = WINDOW_DAYS * 2;

// Days already written in this process, so that each request does not write again.
const noted = new Set<string>();

/** Adds time on the site to today's record (from the website's heartbeat). Never throws. */
export async function addTimeToday(userId: string, seconds: number): Promise<void> {
  const day = indiaDay(new Date());
  try {
    await prisma.userActiveDay.upsert({
      where: { userId_day: { userId, day } },
      create: { userId, day, seconds },
      update: { seconds: { increment: seconds } },
    });
    noted.add(`${userId}|${day}`);
  } catch (err) {
    console.error('Could not record time on the site:', err);
  }
}

/** Records that the user used ExiThreat today. Never throws. */
export async function noteActiveDay(userId: string): Promise<void> {
  const day = indiaDay(new Date());
  const key = `${userId}|${day}`;
  if (noted.has(key)) return;
  try {
    await prisma.userActiveDay.upsert({
      where: { userId_day: { userId, day } },
      create: { userId, day },
      update: {},
    });
    if (noted.size > 50_000) noted.clear();
    noted.add(key);
  } catch (err) {
    console.error('Could not record an active day:', err);
  }
}

interface Stay {
  postId: string;
  from: number;
  to: number;
}

/** The periods posts spent in this group that overlap the window: finished stays and current ones. */
async function staysIn(groupId: string, windowStart: number, now: number): Promise<Stay[]> {
  const [current, left] = await Promise.all([
    prisma.postPlacement.findMany({ where: { groupId }, select: { postId: true, arrivedAt: true } }),
    prisma.postHistory.findMany({
      where: { groupId, movedAt: { gte: new Date(windowStart) } },
      select: { postId: true, arrivedAt: true, movedAt: true },
    }),
  ]);
  return [
    ...left.map((h) => ({ postId: h.postId, from: h.arrivedAt.getTime(), to: h.movedAt.getTime() })),
    ...current.map((p) => ({ postId: p.postId, from: p.arrivedAt.getTime(), to: now })),
  ];
}

export interface ReviewCount {
  reviewed: number;
  due: number;
}

/**
 * For each of these members of the group: how many of the posts that reached it while they
 * were in it (within the window) they went through, and how many they should have by now.
 */
export async function reviewCounts(
  groupId: string,
  members: Array<{ userId: string; joinedAt: Date }>,
  windowStart: number,
  now: number,
): Promise<Map<string, ReviewCount>> {
  const stays = await staysIn(groupId, windowStart, now);
  const views = stays.length === 0 || members.length === 0
    ? []
    : await prisma.viewRecord.findMany({
      where: {
        userId: { in: members.map((m) => m.userId) },
        postId: { in: [...new Set(stays.map((s) => s.postId))] },
        completedAt: { not: null },
        redactedSeenAt: { not: null },
      },
      select: { userId: true, postId: true },
    });
  const reviewedBy = new Set(views.map((v) => `${v.userId}|${v.postId}`));

  const counts = new Map<string, ReviewCount>();
  for (const m of members) {
    const since = Math.max(m.joinedAt.getTime(), windowStart);
    let reviewed = 0;
    let due = 0;
    for (const stay of stays) {
      const from = Math.max(stay.from, since);
      if (stay.to <= from) continue;
      if (reviewedBy.has(`${m.userId}|${stay.postId}`)) {
        reviewed++;
        due++;
      } else if (stay.to - from >= REVIEW_GRACE_MS) {
        due++;
      }
    }
    counts.set(m.userId, { reviewed, due });
  }
  return counts;
}

/** Days the user could have been active: the window, or since `joined` if shorter (at least 1). */
export function possibleDaysSince(joined: number, windowStart: number, now: number): number {
  return Math.max(1, Math.ceil((now - Math.max(joined, windowStart)) / DAY_MS));
}

export async function recalculateGroupWeight(groupId: string): Promise<number> {
  const now = Date.now();
  const windowStart = now - WINDOW_DAYS * DAY_MS;
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true, joinedAt: true },
  });
  const [days, reviews] = await Promise.all([
    prisma.userActiveDay.groupBy({
      by: ['userId'],
      where: { userId: { in: members.map((m) => m.userId) }, day: { gte: indiaDay(new Date(windowStart)) } },
      _count: { _all: true },
    }),
    reviewCounts(groupId, members, windowStart, now),
  ]);
  const activeDays = new Map(days.map((d) => [d.userId, d._count._all]));

  const activity: MemberActivity[] = members.map((m) => ({
    activeDays: activeDays.get(m.userId) ?? 0,
    possibleDays: possibleDaysSince(m.joinedAt.getTime(), windowStart, now),
    ...(reviews.get(m.userId) ?? { reviewed: 0, due: 0 }),
  }));

  const result = groupWeightOf(activity);
  await prisma.group.update({
    where: { id: groupId },
    data: {
      trustScore: result.weight,
      loginScore: result.loginScore,
      reviewScore: result.reviewScore,
      weightUpdatedAt: new Date(now),
    },
  });
  return result.weight;
}

/** Every group, one after another, and old active days removed. Never throws. */
export async function recalculateAllGroupWeights(): Promise<void> {
  try {
    await prisma.userActiveDay.deleteMany({
      where: { day: { lt: indiaDay(new Date(Date.now() - KEEP_DAYS * DAY_MS)) } },
    });
    const groups = await prisma.group.findMany({ select: { id: true } });
    for (const g of groups) await recalculateGroupWeight(g.id);
  } catch (err) {
    console.error('Group weight recalculation failed:', err);
  }
}

export { DAY_MS };
