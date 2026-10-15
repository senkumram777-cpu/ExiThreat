import { Router, Response } from 'express';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { handle } from '../middleware/handle';
import { postAccess, readerGroup, NOT_IN_GROUP } from '../services/accessService';
import { VoteTally, forwardByAuthor, pushIfReady, touchMember, voteTally } from '../services/groupService';
import { recalculateMemberWeight } from '../services/memberWeightService';

const router = Router();

// POST /api/push/:postId/vote — a member votes to push the post on from their group
router.post('/:postId/vote', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { postId } = req.params;
  const userId = req.userId!;

  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, ocUserId: true } });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  // OC cannot vote on their own post
  if (post.ocUserId === userId) {
    res.status(403).json({ error: 'Original Complainant cannot vote on their own post' });
    return;
  }

  // Must be a member of one of the groups the post is in now; the vote counts there.
  const groupId = await readerGroup(postId, userId);
  if (!groupId) {
    res.status(403).json({ error: NOT_IN_GROUP });
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
    where: { postId_groupId_userId: { postId, groupId, userId } },
    create: { postId, groupId, userId },
    update: {},
  });

  await touchMember(groupId, userId);

  // The vote that reaches the threshold forwards the post here and now. `moved` tells the
  // voter that it has left their group, so they can no longer open it.
  const { tally, outcome } = await pushIfReady(post, groupId);
  res.json({ hasVoted: true, hasRead: true, ...tally, moved: outcome === 'moved' });
}));

// DELETE /api/push/:postId/vote — retract a vote
router.delete('/:postId/vote', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { postId } = req.params;
  const userId = req.userId!;

  const groupId = await readerGroup(postId, userId);
  if (groupId) await prisma.pushVote.deleteMany({ where: { postId, groupId, userId } });

  res.json({ voted: false });
}));

// POST /api/push/:postId/manual — the author forwards their post to more groups (once per 24 h,
// adds no weight). It stays in the groups it is in; how many it reaches follows the author's
// own weightage.
router.post('/:postId/manual', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { postId } = req.params;
  const userId = req.userId!;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, ocUserId: true, lastManualPushAt: true },
  });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  // Only the OC can trigger a manual push
  if (post.ocUserId !== userId) {
    res.status(403).json({ error: 'Only the Original Complainant can trigger a manual push' });
    return;
  }

  // The reach follows the author's weightage as of now.
  const { weight } = await recalculateMemberWeight(userId);
  const result = await forwardByAuthor(post, weight);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, ...(result.remainingMs ? { remainingMs: result.remainingMs } : {}) });
    return;
  }

  // Which groups is never said: the author must not learn where their post is read.
  res.json({
    moved: true,
    groupsAdded: result.destinations.length,
    message: `Your post was forwarded to ${result.destinations.length} more group${result.destinations.length !== 1 ? 's' : ''}. `
      + 'It stays in the groups it was already in.',
  });
}));

// GET /api/push/:postId/status — vote status in the caller's group. For the author, who is in
// none of the post's groups, the group whose votes are furthest along.
router.get('/:postId/status', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { postId } = req.params;
  const userId = req.userId!;

  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, ocUserId: true } });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  const access = await postAccess(post, userId);
  if (!access.canRead) {
    res.status(403).json({ error: NOT_IN_GROUP });
    return;
  }

  let tally: VoteTally;
  if (access.groupId) {
    tally = await voteTally(post, access.groupId);
  } else {
    const placements = await prisma.postPlacement.findMany({ where: { postId }, select: { groupId: true } });
    const tallies = await Promise.all(placements.map((p) => voteTally(post, p.groupId)));
    tally = tallies.reduce<VoteTally>(
      (best, t) => (t.pushPercentage > best.pushPercentage ? t : best),
      { voteCount: 0, totalMembers: 0, pushPercentage: 0, thresholdReached: false },
    );
  }

  const [userVote, view] = await Promise.all([
    access.groupId
      ? prisma.pushVote.findUnique({ where: { postId_groupId_userId: { postId, groupId: access.groupId, userId } } })
      : Promise.resolve(null),
    prisma.viewRecord.findUnique({
      where: { postId_userId: { postId, userId } },
      select: { id: true },
    }),
  ]);

  res.json({ hasVoted: !!userVote, hasRead: !!view, ...tally });
}));

export default router;
