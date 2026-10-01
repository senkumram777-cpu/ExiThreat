import { Router, Response } from 'express';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { generatePaperStrip } from '../services/imageService';
import { redactContent } from '../services/redactionService';

const router = Router();

// POST /api/posts — create a new post (OC submits complaint)
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { content } = req.body as { content?: string };
  if (!content || content.trim().length < 20) {
    res.status(400).json({ error: 'content must be at least 20 characters' });
    return;
  }

  // Assign to a random group
  const groupCount = await prisma.group.count();
  if (groupCount === 0) {
    res.status(503).json({ error: 'No groups available. An admin must create groups first.' });
    return;
  }
  const randomGroup = await prisma.group.findFirst({
    skip: Math.floor(Math.random() * groupCount),
  });

  const originalContent = content.trim();
  const redactedContent = redactContent(originalContent);

  const post = await prisma.post.create({
    data: {
      originalContent,
      redactedContent,
      ocUserId: userId,
      currentGroupId: randomGroup!.id,
    },
    select: {
      id: true,
      redactedContent: true,
      totalWeight: true,
      createdAt: true,
      currentGroupId: true,
    },
  });

  res.status(201).json(post);
});

// GET /api/posts/:id/strip — serves the PNG paper strip (unredacted, first-look only)
router.get('/:id/strip', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;

  // Check if user has already viewed this post
  const existing = await prisma.viewRecord.findUnique({
    where: { postId_userId: { postId: id, userId } },
  });
  if (existing) {
    res.status(403).json({ error: 'First-look already consumed. Access the redacted version.' });
    return;
  }

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  // Verify user is a member of the post's current group
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: post.currentGroupId, userId } },
  });
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this post\'s current group' });
    return;
  }

  // Record the view (server-side audit; RxDB is canonical on client)
  await prisma.viewRecord.create({ data: { postId: id, userId } });

  // Increment read-through count for trust score
  await prisma.groupMember.update({
    where: { groupId_userId: { groupId: post.currentGroupId, userId } },
    data: { readThroughCount: { increment: 1 } },
  });

  const pngBuffer = await generatePaperStrip(post.originalContent);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(pngBuffer);
});

// GET /api/posts/:id — fetch post metadata + redacted content
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      id: true,
      redactedContent: true,
      totalWeight: true,
      createdAt: true,
      currentGroupId: true,
      ocUserId: true,
      lastManualPushAt: true,
      _count: { select: { pushVotes: true, comments: true } },
    },
  });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  res.json(post);
});

// GET /api/posts/:id/comments — fetch all tagged comments (travel with post)
router.get('/:id/comments', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const comments = await prisma.comment.findMany({
    where: { postId: id },
    include: { user: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(comments);
});

// POST /api/posts/:id/comments — add a tagged comment (travels with post)
router.post('/:id/comments', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;
  const { content } = req.body as { content?: string };
  if (!content || content.trim().length === 0) {
    res.status(400).json({ error: 'content required' });
    return;
  }

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  // Must be a member of the post's current group to comment
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: post.currentGroupId, userId } },
  });
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this post\'s current group' });
    return;
  }

  const comment = await prisma.comment.create({
    data: { postId: id, userId, content: content.trim() },
    include: { user: { select: { id: true, username: true } } },
  });
  res.status(201).json(comment);
});

export default router;
