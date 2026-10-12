/**
 * Push Observer
 *
 * Polls the PushVotes table periodically. When a post's votes reach the threshold in the
 * group it is in (see voteTally in groupService.ts), it moves the post to another group
 * (pickGroupForPost) and records the push percentage in its history (movePost).
 *
 * The observer runs every 10 seconds.  In production this should be
 * replaced by a Postgres LISTEN/NOTIFY trigger for real-time behaviour.
 */

import { prisma } from '../index';
import { movePost, pickGroupForPost, voteTally } from './groupService';

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
      await evaluateAndMaybeMove(vc.postId, vc.groupId);
    }
  } catch (err) {
    console.error('Push observer error:', err);
  }
}

async function evaluateAndMaybeMove(postId: string, groupId: string): Promise<void> {
  // Fetch the post to confirm it is still in this group
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.currentGroupId !== groupId) return;

  const tally = await voteTally(post);
  if (!tally.thresholdReached) return;

  const newGroupId = await pickGroupForPost(post.ocUserId, post);
  if (!newGroupId) {
    console.warn(`No other group available for post ${postId}`);
    return;
  }

  if (await movePost(postId, groupId, newGroupId, tally.pushPercentage, false)) {
    console.log(
      `Post ${postId} moved from group ${groupId} → ${newGroupId} ` +
      `(push% = ${tally.pushPercentage.toFixed(1)})`,
    );
  }
}
