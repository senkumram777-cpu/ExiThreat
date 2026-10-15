/**
 * Works out and stores each post's spread (spread.ts): after every push that moves it, and
 * hourly for all posts, since the number of eligible groups changes as groups fill up.
 */

import { prisma } from '../index';
import { reachesList, shareOf, spreadScoreOf } from './spread';
// groupService imports this file too; groupMinMembers is only called inside functions.
import { groupMinMembers } from './groupService';
import { rule } from './settings';

interface Common {
  /** Groups with enough members to take posts. */
  big: Set<string>;
  /** Each user's groups. */
  groupsOf: Map<string, Set<string>>;
}

async function common(): Promise<Common> {
  const [counts, memberships] = await Promise.all([
    prisma.groupMember.groupBy({ by: ['groupId'], _count: { _all: true } }),
    prisma.groupMember.findMany({ select: { userId: true, groupId: true } }),
  ]);
  const big = new Set(counts.filter((c) => c._count._all >= groupMinMembers()).map((c) => c.groupId));
  const groupsOf = new Map<string, Set<string>>();
  for (const m of memberships) {
    if (!groupsOf.has(m.userId)) groupsOf.set(m.userId, new Set());
    groupsOf.get(m.userId)!.add(m.groupId);
  }
  return { big, groupsOf };
}

async function store(
  post: { id: string; ocUserId: string; createdAt: Date; listedAt: Date | null },
  reachedIds: string[],
  { big, groupsOf }: Common,
  now: Date,
): Promise<void> {
  const authorIn = groupsOf.get(post.ocUserId) ?? new Set<string>();
  const eligible = [...big].filter((id) => !authorIn.has(id));
  const eligibleSet = new Set(eligible);
  const reached = new Set(reachedIds.filter((id) => eligibleSet.has(id))).size;
  const share = shareOf(reached, eligible.length);
  await prisma.post.update({
    where: { id: post.id },
    data: {
      reachedGroups: reached,
      eligibleGroups: eligible.length,
      spreadScore: spreadScoreOf(share, now.getTime() - post.createdAt.getTime()),
      spreadUpdatedAt: now,
      // Once listed, always listed: only its place in the list changes.
      ...(!post.listedAt && reachesList(share, rule('listShare')) ? { listedAt: now } : {}),
    },
  });
}

const POST_FIELDS = { id: true, ocUserId: true, createdAt: true, listedAt: true } as const;

export async function recalculateSpread(postId: string): Promise<void> {
  const [post, history, placements, shared] = await Promise.all([
    prisma.post.findUnique({ where: { id: postId }, select: POST_FIELDS }),
    prisma.postHistory.findMany({ where: { postId }, select: { groupId: true } }),
    prisma.postPlacement.findMany({ where: { postId }, select: { groupId: true } }),
    common(),
  ]);
  if (!post) return;
  await store(post, [...history, ...placements].map((r) => r.groupId), shared, new Date());
}

export async function recalculateAllSpreads(): Promise<void> {
  try {
    const [posts, history, placements, shared] = await Promise.all([
      prisma.post.findMany({ select: POST_FIELDS }),
      prisma.postHistory.findMany({ select: { postId: true, groupId: true } }),
      prisma.postPlacement.findMany({ select: { postId: true, groupId: true } }),
      common(),
    ]);
    const reachedBy = new Map<string, string[]>();
    for (const r of [...history, ...placements]) {
      if (!reachedBy.has(r.postId)) reachedBy.set(r.postId, []);
      reachedBy.get(r.postId)!.push(r.groupId);
    }
    const now = new Date();
    for (const post of posts) await store(post, reachedBy.get(post.id) ?? [], shared, now);
  } catch (err) {
    console.error('Spread recalculation failed:', err);
  }
}
