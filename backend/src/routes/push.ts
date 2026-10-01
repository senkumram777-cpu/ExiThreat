import { Router, Response } from 'express';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

const MANUAL_PUSH_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

// POST /api/push/:postId/vote — member votes to push content
router.post('/:postId/vote', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { postId } = req.params;
  const userId = req.userId!;

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  // Must be a member of the current group
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: post.currentGroupId, userId } },
  });
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this post\'s current group' });
    return;
  }

  // OC cannot vote on their own post
  if (post.ocUserId === userId) {
    res.status(403).json({ error: 'Original Complainant cannot vote on their own post' });
    return;
  }

  // Upsert vote (idempotent)
  await prisma.pushVote.upsert({
    where: { postId_groupId_userId: { postId, groupId: post.currentGroupId, userId } },
    create: { postId, groupId: post.currentGroupId, userId },
    update: {},
  });

  // Return current vote count vs total members
  const [voteCount, totalMembers] = await Promise.all([
    prisma.pushVote.count({ where: { postId, groupId: post.currentGroupId } }),
    prisma.groupMember.count({ where: { groupId: post.currentGroupId } }),
  ]);

  res.json({
    voted: true,
    voteCount,
    totalMembers,
    pushPercentage: totalMembers > 0 ? (voteCount / totalMembers) * 100 : 0,
    thresholdReached: totalMembers > 0 && voteCount / totalMembers >= 0.5,
  });
});

// DELETE /api/push/:postId/vote — retract a vote
router.delete('/:postId/vote', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { postId } = req.params;
  const userId = req.userId!;

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  await prisma.pushVote.deleteMany({
    where: { postId, groupId: post.currentGroupId, userId },
  });

  res.json({ voted: false });
});

// POST /api/push/:postId/manual — OC manual push (once per 24h, 0 weightage)
router.post('/:postId/manual', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { postId } = req.params;
  const userId = req.userId!;

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  // Only the OC can trigger a manual push
  if (post.ocUserId !== userId) {
    res.status(403).json({ error: 'Only the Original Complainant can trigger a manual push' });
    return;
  }

  // Enforce 24-hour cooldown
  if (post.lastManualPushAt) {
    const elapsed = Date.now() - post.lastManualPushAt.getTime();
    if (elapsed < MANUAL_PUSH_COOLDOWN_MS) {
      const remainingMs = MANUAL_PUSH_COOLDOWN_MS - elapsed;
      const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
      res.status(429).json({
        error: `Manual push on cooldown. Try again in ${remainingHours} hour(s).`,
        remainingMs,
      });
      return;
    }
  }

  // Select a random new group
  const currentGroupId = post.currentGroupId;
  const groupCount = await prisma.group.count({ where: { id: { not: currentGroupId } } });
  if (groupCount === 0) {
    res.status(503).json({ error: 'No other groups available' });
    return;
  }
  const newGroup = await prisma.group.findFirst({
    where: { id: { not: currentGroupId } },
    skip: Math.floor(Math.random() * groupCount),
  });

  // Record history with wasManualPush=true and pushPercentage=0
  await prisma.$transaction([
    prisma.postHistory.create({
      data: {
        postId,
        groupId: currentGroupId,
        pushPercentage: 0,
        wasManualPush: true,
      },
    }),
    // Invalidate all current group votes (collision logic: group loses push privilege)
    prisma.pushVote.deleteMany({ where: { postId, groupId: currentGroupId } }),
    prisma.post.update({
      where: { id: postId },
      data: {
        currentGroupId: newGroup!.id,
        lastManualPushAt: new Date(),
        // totalWeight unchanged — manual push carries 0 weightage
      },
    }),
  ]);

  res.json({
    moved: true,
    newGroupId: newGroup!.id,
    message: 'Post manually pushed to a new group. Current group\'s votes have been cleared.',
  });
});

// GET /api/push/:postId/status — current vote status for the calling user's group
router.get('/:postId/status', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { postId } = req.params;
  const userId = req.userId!;

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  const [userVote, voteCount, totalMembers] = await Promise.all([
    prisma.pushVote.findUnique({
      where: { postId_groupId_userId: { postId, groupId: post.currentGroupId, userId } },
    }),
    prisma.pushVote.count({ where: { postId, groupId: post.currentGroupId } }),
    prisma.groupMember.count({ where: { groupId: post.currentGroupId } }),
  ]);

  res.json({
    hasVoted: !!userVote,
    voteCount,
    totalMembers,
    pushPercentage: totalMembers > 0 ? (voteCount / totalMembers) * 100 : 0,
    thresholdReached: totalMembers > 0 && voteCount / totalMembers >= 0.5,
  });
});

export default router;
