import { Router, Response } from 'express';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { handle } from '../middleware/handle';
import { recalculateGroupTrustScore } from '../services/weightageService';
import { isGroupMember } from '../services/accessService';
import { ensureGroup, touchMember } from '../services/groupService';
import { LIMITS, readText } from '../services/validation';

const router = Router();

// GET /api/groups — the caller's own groups (summary). Other groups are not listed, and
// nobody joins or creates one: the server assigns it (services/groupService.ts).
router.get('/', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  await ensureGroup(userId);
  const groups = await prisma.group.findMany({
    where: { members: { some: { userId } } },
    select: {
      id: true,
      name: true,
      trustScore: true,
      createdAt: true,
      _count: { select: { members: true, currentPosts: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(groups);
}));

// GET /api/groups/:id — group detail with member names and current posts. Members only.
router.get('/:id', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const summary = await prisma.group.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      trustScore: true,
      createdAt: true,
      _count: { select: { members: true, currentPosts: true } },
    },
  });
  if (!summary) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  if (!(await isGroupMember(id, req.userId!))) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }
  await touchMember(id, req.userId!);

  const [members, currentPosts] = await Promise.all([
    prisma.groupMember.findMany({
      where: { groupId: id },
      select: { user: { select: { username: true } } },
    }),
    prisma.post.findMany({
      where: { currentGroupId: id },
      select: {
        id: true,
        redactedContent: true,
        totalWeight: true,
        createdAt: true,
        _count: { select: { pushVotes: true, comments: true } },
      },
    }),
  ]);
  res.json({
    ...summary,
    isMember: true,
    members: members.map((m) => ({ username: m.user.username })),
    currentPosts,
  });
}));

// POST /api/groups/:id/heartbeat — update activeness metrics
router.post('/:id/heartbeat', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;
  const secondsSpent = (req.body as { secondsSpent?: unknown } | undefined)?.secondsSpent;

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });
  if (!member) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  // `secondsSpent` is the time since the last heartbeat, which comes once a minute.
  await prisma.groupMember.update({
    where: { groupId_userId: { groupId: id, userId } },
    data: {
      visitCount: { increment: 1 },
      totalTimeSpent: { increment: Math.min(120, Math.max(0, Math.floor(Number(secondsSpent) || 0))) },
      lastSeenAt: new Date(),
    },
  });

  // Asynchronously recompute trust score — fire and forget
  recalculateGroupTrustScore(id).catch(console.error);

  res.json({ ok: true });
}));

// GET /api/groups/:id/chat — fetch group-local chat messages
router.get('/:id/chat', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!(await isGroupMember(id, req.userId!))) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const messages = await prisma.chatMessage.findMany({
    where: { groupId: id },
    include: { user: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(messages.reverse());
}));

// POST /api/groups/:id/chat — post a chat message (stays local)
router.post('/:id/chat', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;
  const content = readText(req.body?.content, 'content', LIMITS.chatMax);
  if (!content.ok) {
    res.status(400).json({ error: content.error });
    return;
  }
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });
  if (!member) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }
  const message = await prisma.chatMessage.create({
    data: { groupId: id, userId, content: content.text },
    include: { user: { select: { id: true, username: true } } },
  });
  res.status(201).json(message);
}));

export default router;
