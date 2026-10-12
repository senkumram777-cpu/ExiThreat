import { Router, Response } from 'express';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { handle } from '../middleware/handle';
import { generatePaperStrip } from '../services/imageService';
import { redactContent } from '../services/redactionService';
import { postAccess, postAccessById, NOT_IN_GROUP } from '../services/accessService';
import { pickGroupForPost } from '../services/groupService';
import { LIMITS, readText } from '../services/validation';

const router = Router();

// A first look that was opened but never closed (lost connection, reload) can be opened again
// for this long. After that, or once the reader closes it, it is used up.
const FIRST_LOOK_WINDOW_MS = 10 * 60 * 1000;

function firstLookOpen(record: { viewedAt: Date; completedAt: Date | null } | null): boolean {
  if (!record) return true;
  return !record.completedAt && Date.now() - record.viewedAt.getTime() < FIRST_LOOK_WINDOW_MS;
}

// POST /api/posts — create a new post (OC submits complaint)
router.post('/', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const content = readText(req.body?.content, 'content', LIMITS.postMax, LIMITS.postMin);
  if (!content.ok) {
    res.status(400).json({ error: content.error });
    return;
  }

  // Assign to a random group that has enough members and that the author is not in
  const groupId = await pickGroupForPost(userId);
  if (!groupId) {
    res.status(503).json({
      error: 'There are not yet enough members in other groups to review a disclosure safely. '
        + 'Nothing was saved. Please try again later.',
    });
    return;
  }

  const originalContent = content.text;
  const redactedContent = redactContent(originalContent);

  const post = await prisma.post.create({
    data: {
      originalContent,
      redactedContent,
      ocUserId: userId,
      currentGroupId: groupId,
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
}));

// POST /api/posts/preview — what the redacted version of this text would be. Saves nothing.
router.post('/preview', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const content = readText(req.body?.content, 'content', LIMITS.postMax, LIMITS.postMin);
  if (!content.ok) {
    res.status(400).json({ error: content.error });
    return;
  }
  res.json({ redactedContent: redactContent(content.text) });
}));

// GET /api/posts/mine — the caller's own posts, newest first
router.get('/mine', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const posts = await prisma.post.findMany({
    where: { ocUserId: req.userId! },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      redactedContent: true,
      totalWeight: true,
      createdAt: true,
      lastManualPushAt: true,
      _count: { select: { pushVotes: true, comments: true, history: true } },
    },
  });
  res.json(posts);
}));

// GET /api/posts/:id/strip — serves the PNG paper strip (unredacted, first-look only)
router.get('/:id/strip', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;

  try {
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    // Verify user is a member of the post's current group
    const access = await postAccess(post, userId);
    if (!access.isMember) {
      res.status(403).json({ error: NOT_IN_GROUP });
      return;
    }

    const existing = await prisma.viewRecord.findUnique({
      where: { postId_userId: { postId: id, userId } },
    });
    if (!firstLookOpen(existing)) {
      res.status(403).json({ error: 'First-look already consumed. Access the redacted version.' });
      return;
    }

    // The image is made before the view is recorded, so a failure here costs the reader nothing.
    const pngBuffer = await generatePaperStrip(post.originalContent);

    // Keeps the time of the first opening if this is a second one inside the window.
    await prisma.viewRecord.upsert({
      where: { postId_userId: { postId: id, userId } },
      create: { postId: id, userId },
      update: {},
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(pngBuffer);
  } catch (err) {
    console.error('First-look strip failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not prepare the first look' });
  }
}));

// POST /api/posts/:id/strip/done — the reader closed the first look; it is now used up
router.post('/:id/strip/done', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;

  // Only an opened, not yet closed look can be closed, and only once.
  const closed = await prisma.viewRecord.updateMany({
    where: { postId: id, userId, completedAt: null },
    data: { completedAt: new Date() },
  });

  if (closed.count > 0) {
    // Increment read-through count for trust score
    const post = await prisma.post.findUnique({ where: { id }, select: { currentGroupId: true } });
    if (post) {
      await prisma.groupMember.updateMany({
        where: { groupId: post.currentGroupId, userId },
        data: { readThroughCount: { increment: 1 } },
      });
    }
  }

  res.json({ ok: true });
}));

// GET /api/posts/:id — fetch post metadata + redacted content.
// Only for members of the post's current group and its author. Who wrote it is never sent:
// the caller is told only whether it is their own.
router.get('/:id', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;
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

  const access = await postAccess(post, userId);
  if (!access.canRead) {
    res.status(403).json({ error: NOT_IN_GROUP });
    return;
  }

  // The author wrote the text and has no first look to spend.
  let firstLook: 'available' | 'used' = 'used';
  if (access.isMember && !access.isAuthor) {
    const record = await prisma.viewRecord.findUnique({
      where: { postId_userId: { postId: id, userId } },
    });
    if (firstLookOpen(record)) firstLook = 'available';
  }

  const { ocUserId: _author, ...rest } = post;
  res.json({ ...rest, isAuthor: access.isAuthor, isMember: access.isMember, firstLook });
}));

// GET /api/posts/:id/comments — fetch all tagged comments (travel with post)
router.get('/:id/comments', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const access = await postAccessById(id, req.userId!);
  if (!access) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  if (!access.canRead) {
    res.status(403).json({ error: NOT_IN_GROUP });
    return;
  }
  const comments = await prisma.comment.findMany({
    where: { postId: id },
    include: { user: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(comments);
}));

// POST /api/posts/:id/comments — add a tagged comment (travels with post)
router.post('/:id/comments', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;
  const content = readText(req.body?.content, 'content', LIMITS.commentMax);
  if (!content.ok) {
    res.status(400).json({ error: content.error });
    return;
  }

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  // Must be a member of the post's current group to comment
  const access = await postAccess(post, userId);
  if (!access.isMember) {
    res.status(403).json({ error: NOT_IN_GROUP });
    return;
  }

  const comment = await prisma.comment.create({
    data: { postId: id, userId, content: content.text },
    include: { user: { select: { id: true, username: true } } },
  });
  res.status(201).json(comment);
}));

export default router;
