/**
 * Push Observer
 *
 * Polls the PushVotes table periodically.  When the ratio of votes to
 * total group members reaches >= 0.5 (50%), it:
 *
 *  1. Selects a random new group (excluding the current one).
 *  2. Writes a PostHistory record capturing the push percentage.
 *  3. Updates Post.currentGroupId to the new group.
 *  4. Deletes PushVotes for the old group so the new group starts fresh.
 *
 * The observer runs every 10 seconds.  In production this should be
 * replaced by a Postgres LISTEN/NOTIFY trigger for real-time behaviour.
 */

import { prisma } from '../index';

const POLL_INTERVAL_MS = 10_000;

export function startPushObserver(): void {
  console.log('Push observer started (polling every 10s)');
  setInterval(runObserverCycle, POLL_INTERVAL_MS);
}

async function runObserverCycle(): Promise<void> {
  try {
    // Find all (post, group) pairs that have at least one vote
    const voteCounts = await prisma.pushVote.groupBy({
      by: ['postId', 'groupId'],
      _count: { id: true },
    });

    for (const vc of voteCounts) {
      await evaluateAndMaybeMove(vc.postId, vc.groupId, vc._count.id);
    }
  } catch (err) {
    console.error('Push observer error:', err);
  }
}

async function evaluateAndMaybeMove(
  postId: string,
  groupId: string,
  voteCount: number,
): Promise<void> {
  // Fetch the post to confirm it is still in this group
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.currentGroupId !== groupId) return;

  // Count total members in this group
  const totalMembers = await prisma.groupMember.count({ where: { groupId } });
  if (totalMembers === 0) return;

  const pushPercentage = (voteCount / totalMembers) * 100;
  if (pushPercentage < 50) return;

  // Threshold reached — find a new random group
  const newGroup = await prisma.group.findFirst({
    where: { id: { not: groupId } },
    orderBy: { id: 'asc' }, // deterministic fallback; shuffle via skip below
    skip: Math.floor(Math.random() * Math.max(1, await prisma.group.count({ where: { id: { not: groupId } } }) - 1)),
  });

  if (!newGroup) {
    console.warn(`No other group available for post ${postId}`);
    return;
  }

  // Transactionally record history, move post, clear votes
  await prisma.$transaction([
    prisma.postHistory.create({
      data: {
        postId,
        groupId,
        pushPercentage,
        wasManualPush: false,
      },
    }),
    prisma.post.update({
      where: { id: postId },
      data: {
        currentGroupId: newGroup.id,
        totalWeight: { increment: pushPercentage },
      },
    }),
    prisma.pushVote.deleteMany({ where: { postId, groupId } }),
  ]);

  console.log(
    `Post ${postId} moved from group ${groupId} → ${newGroup.id} ` +
    `(push% = ${pushPercentage.toFixed(1)})`,
  );
}
