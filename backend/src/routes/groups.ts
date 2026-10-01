import { Router, Response } from 'express';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { recalculateGroupTrustScore } from '../services/weightageService';

const router = Router();

// GET /api/groups — list all groups (summary)
router.get('/', requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  const groups = await prisma.group.findMany({
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
});

// GET /api/groups/:id — group detail + members + current posts
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const group = await prisma.group.findUnique({
    where: { id },
    include: {
      members: {
        include: { user: { select: { id: true, username: true } } },
      },
      currentPosts: {
        select: {
          id: true,
          redactedContent: true,
          totalWeight: true,
          createdAt: true,
          _count: { select: { pushVotes: true, comments: true } },
        },
      },
    },
  });
  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }
  res.json(group);
});

// POST /api/groups — create a new group (admin / seeding)
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name } = req.body as { name?: string };
  if (!name || name.trim().length === 0) {
    res.status(400).json({ error: 'name required' });
    return;
  }
  const group = await prisma.group.create({ data: { name: name.trim() } });
  res.status(201).json(group);
});

// POST /api/groups/:id/join — join a group
router.post('/:id/join', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;
  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }
  const existing = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });
  if (existing) {
    res.status(409).json({ error: 'Already a member' });
    return;
  }
  const member = await prisma.groupMember.create({ data: { groupId: id, userId } });
  res.status(201).json(member);
});

// POST /api/groups/:id/heartbeat — update activeness metrics
router.post('/:id/heartbeat', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;
  const { secondsSpent = 0 } = req.body as { secondsSpent?: number };

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });
  if (!member) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  await prisma.groupMember.update({
    where: { groupId_userId: { groupId: id, userId } },
    data: {
      visitCount: { increment: 1 },
      totalTimeSpent: { increment: Math.max(0, Math.floor(secondsSpent)) },
    },
  });

  // Asynchronously recompute trust score — fire and forget
  recalculateGroupTrustScore(id).catch(console.error);

  res.json({ ok: true });
});

// GET /api/groups/:id/chat — fetch group-local chat messages
router.get('/:id/chat', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const messages = await prisma.chatMessage.findMany({
    where: { groupId: id },
    include: { user: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(messages.reverse());
});

// POST /api/groups/:id/chat — post a chat message (stays local)
router.post('/:id/chat', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;
  const { content } = req.body as { content?: string };
  if (!content || content.trim().length === 0) {
    res.status(400).json({ error: 'content required' });
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
    data: { groupId: id, userId, content: content.trim() },
    include: { user: { select: { id: true, username: true } } },
  });
  res.status(201).json(message);
});

export default router;
