import { Router, Response } from 'express';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { handle } from '../middleware/handle';
import { isGroupMember } from '../services/accessService';
import { ensureGroup, touchMember } from '../services/groupService';
import { LIMITS, readText } from '../services/validation';

const router = Router();

/** The posts a group holds now are its placements; the website calls them `currentPosts`. */
function withPostCount<T extends { _count: { members: number; placements: number } }>(group: T) {
  const { _count, ...rest } = group;
  return { ...rest, _count: { members: _count.members, currentPosts: _count.placements } };
}

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
      loginScore: true,
      reviewScore: true,
      weightUpdatedAt: true,
      createdAt: true,
      _count: { select: { members: true, placements: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(groups.map(withPostCount));
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
      loginScore: true,
      reviewScore: true,
      weightUpdatedAt: true,
      createdAt: true,
      _count: { select: { members: true, placements: true } },
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

  const [me, currentPosts] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: req.userId! }, select: { pseudonym: true } }),
    prisma.post.findMany({
      where: { placements: { some: { groupId: id } }, hiddenAt: null },
      select: {
        id: true,
        redactedContent: true,
        totalWeight: true,
        createdAt: true,
        oc: { select: { pseudonym: true } },
        // Only this group's votes: other groups holding the same post vote separately.
        _count: { select: { pushVotes: { where: { groupId: id } }, comments: true } },
      },
    }),
  ]);
  res.json({
    ...withPostCount(summary),
    isMember: true,
    // Members are never listed: who is in a group is not shown to the others, only how many.
    // The reader's own pseudonym is what their chat messages and comments show.
    myPseudonym: me.pseudonym,
    // Each post with its author's pseudonym, never the username.
    currentPosts: currentPosts.map(({ oc, ...post }) => ({ ...post, author: oc.pseudonym })),
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
    include: { user: { select: { pseudonym: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(messages.reverse().map((m) => chatOut(m, req.userId!)));
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
    include: { user: { select: { pseudonym: true } } },
  });
  res.status(201).json(chatOut(message, userId));
}));

/** A chat message as members see it: by pseudonym, never the username or account id. */
function chatOut(
  m: { id: string; groupId: string; userId: string; content: string; createdAt: Date; user: { pseudonym: string } },
  readerId: string,
) {
  return { id: m.id, groupId: m.groupId, content: m.content, createdAt: m.createdAt, author: m.user.pseudonym, mine: m.userId === readerId };
}

export default router;
