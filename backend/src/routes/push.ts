import { Router, Response } from 'express';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { postAccess, NOT_IN_GROUP } from '../services/accessService';
import { movePost, pickGroupForPost, touchMember, voteTally } from '../services/groupService';

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

  // Only someone who has opened the post's first look can vote on it
  const view = await prisma.viewRecord.findUnique({
    where: { postId_userId: { postId, userId } },
    select: { id: true },
  });
  if (!view) {
    res.status(403).json({ error: 'Read the first look before voting' });
    return;
  }

  // Upsert vote (idempotent)
  await prisma.pushVote.upsert({
    where: { postId_groupId_userId: { postId, groupId: post.currentGroupId, userId } },
    create: { postId, groupId: post.currentGroupId, userId },
    update: {},
  });

  await touchMember(post.currentGroupId, userId);

  res.json({ hasVoted: true, hasRead: true, ...(await voteTally(post)) });
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
  const newGroupId = await pickGroupForPost(userId, post);
  if (!newGroupId) {
    res.status(503).json({ error: 'No other group with enough members is available yet' });
    return;
  }

  // Recorded with wasManualPush=true and pushPercentage=0: it adds nothing to the weight, and
  // the current group's votes are cleared (collision logic: group loses push privilege).
  if (!(await movePost(postId, currentGroupId, newGroupId, 0, true))) {
    res.status(409).json({ error: 'The post has just moved to another group' });
    return;
  }

  res.json({
    moved: true,
    newGroupId,
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
  if (!(await postAccess(post, userId)).canRead) {
    res.status(403).json({ error: NOT_IN_GROUP });
    return;
  }

  const [userVote, view, tally] = await Promise.all([
    prisma.pushVote.findUnique({
      where: { postId_groupId_userId: { postId, groupId: post.currentGroupId, userId } },
    }),
    prisma.viewRecord.findUnique({
      where: { postId_userId: { postId, userId } },
      select: { id: true },
    }),
    voteTally(post),
  ]);

  res.json({ hasVoted: !!userVote, hasRead: !!view, ...tally });
});

export default router;
