import { Router, Request, Response } from 'express';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { handle } from '../middleware/handle';
import { generatePaperStrip } from '../services/imageService';
import { redactContent } from '../services/redactionService';
import { postAccess, postAccessById, readerGroup, NOT_IN_GROUP } from '../services/accessService';
import { pickGroupForPost } from '../services/groupService';
import { recalculateGroupWeight } from '../services/groupWeightService';
import { groupMapFor } from '../services/groupMapService';
import { recalculateSpread } from '../services/spreadService';
import { LIMITS, readText } from '../services/validation';

const router = Router();

// A first look that was opened but never closed (lost connection, reload) can be opened again
// for this long. After that, or once the reader closes it, it is used up.
const FIRST_LOOK_WINDOW_MS = 10 * 60 * 1000;

function firstLookOpen(record: { viewedAt: Date; completedAt: Date | null } | null): boolean {
  if (!record) return true;
  return !record.completedAt && Date.now() - record.viewedAt.getTime() < FIRST_LOOK_WINDOW_MS;
}

// The groups a post is in now, latest arrival first.
const PLACEMENTS = { orderBy: { arrivedAt: 'desc' as const }, select: { arrivedAt: true } };

/**
 * How far a post has travelled, for its author only: groups it has left, groups it is in now,
 * and when it last reached a group. Which groups is on its map (GET /posts/:id/map).
 */
function journeyOf(post: { createdAt: Date }, groupsPassed: number, placements: Array<{ arrivedAt: Date }>) {
  return {
    groupsPassed,
    inGroups: placements.length,
    arrivedAt: placements[0]?.arrivedAt ?? post.createdAt,
  };
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
      placements: { create: { groupId } },
    },
    select: {
      id: true,
      redactedContent: true,
      totalWeight: true,
      createdAt: true,
    },
  });

  // Its first group counts towards the share of groups it has reached.
  await recalculateSpread(post.id);
  res.status(201).json({ ...post, groupId });
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
      hiddenAt: true,
      _count: { select: { pushVotes: true, comments: true, history: true } },
      placements: PLACEMENTS,
    },
  });
  res.json(posts.map(({ placements, ...post }) => {
    const journey = journeyOf(post, post._count.history, placements);
    return { ...post, arrivedAt: journey.arrivedAt, inGroups: journey.inGroups };
  }));
}));

// GET /api/posts/:id/strip — the first look (unredacted): the PNG paper strip in base64, drawn as
// rows the website lays end to end into one scrolling line, with each row's width.
// HEAD /api/posts/:id/strip — refused. Express would otherwise answer it with the GET below,
// which records the first look as opened: a link preview or prefetch could use up a member's
// one look (and count as having read it) without anything being shown.
router.head('/:id/strip', (_req: Request, res: Response): void => {
  res.status(405).set('Allow', 'GET').end();
});

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
    const strip = await generatePaperStrip(post.originalContent);

    // Keeps the time of the first opening if this is a second one inside the window.
    await prisma.viewRecord.upsert({
      where: { postId_userId: { postId: id, userId } },
      create: { postId: id, userId },
      update: {},
    });

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({
      image: strip.png.toString('base64'),
      rows: strip.rows,
      rowHeight: strip.rowHeight,
      scale: strip.scale,
    });
  } catch (err) {
    console.error('First-look strip failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not prepare the first look' });
  }
}));

// POST /api/posts/:id/strip/done — the reader closed the first look; it is now used up.
// `reason` is "done" when they tapped "Done reading", which then shows the redacted version,
// and "left" when they left the page. Only "done" counts as having gone through the post.
router.post('/:id/strip/done', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.userId!;
  const finished = (req.body as { reason?: unknown } | undefined)?.reason === 'done';
  const now = new Date();

  // Only an opened, not yet closed look can be closed, and only once.
  const closed = await prisma.viewRecord.updateMany({
    where: { postId: id, userId, completedAt: null },
    data: { completedAt: now, ...(finished ? { redactedSeenAt: now } : {}) },
  });

  if (closed.count > 0) {
    const groupId = await readerGroup(id, userId);
    if (groupId) {
      await prisma.groupMember.updateMany({
        where: { groupId, userId },
        data: { readThroughCount: { increment: 1 } },
      });
      if (finished) recalculateGroupWeight(groupId).catch((err) => console.error(err));
    }
  }

  res.json({ ok: true });
}));

// GET /api/posts/:id — fetch post metadata + redacted content.
// Only for members of the post's current group and its author. Who wrote it is sent only as
// their pseudonym, and whether it is the caller's own.
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
      ocUserId: true,
      lastManualPushAt: true,
      hiddenAt: true,
      _count: { select: { pushVotes: true, comments: true, history: true } },
      placements: PLACEMENTS,
      oc: { select: { pseudonym: true } },
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
    // Coming back to a post whose first look they finished: they now see the redacted version.
    else if (record?.completedAt && !record.redactedSeenAt) {
      await prisma.viewRecord.update({ where: { id: record.id }, data: { redactedSeenAt: new Date() } });
      if (access.groupId) recalculateGroupWeight(access.groupId).catch((err) => console.error(err));
    }
  }

  // Only the author can still open a hidden post (accessService), and is told it is hidden.
  const { ocUserId: _author, placements, _count, oc, hiddenAt, ...rest } = post;
  res.json({
    ...rest,
    // The author's pseudonym, never their username.
    author: oc.pseudonym,
    _count: { pushVotes: _count.pushVotes, comments: _count.comments },
    isAuthor: access.isAuthor,
    isMember: access.isMember,
    // The reader's own group, for the way back; never the others the post is in.
    groupId: access.groupId,
    firstLook,
    hidden: hiddenAt !== null,
    // Only the author is told how far the post has travelled and since when it is where it is.
    ...(access.isAuthor ? { journey: journeyOf(post, _count.history, placements) } : {}),
  });
}));

// GET /api/posts/:id/map — for the author only: the groups their post can reach, by name and
// weight, with the ones it has passed through and the ones it is in now, and the path between
// them. No members, no member counts, no group ids.
router.get('/:id/map', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, ocUserId: true } });
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  if (post.ocUserId !== req.userId) {
    res.status(403).json({ error: 'Only the author can see where their post has been' });
    return;
  }
  res.json(await groupMapFor(post));
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
    include: { user: { select: { pseudonym: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(comments.map((c) => commentOut(c, req.userId!)));
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
    include: { user: { select: { pseudonym: true } } },
  });
  res.status(201).json(commentOut(comment, userId));
}));

/**
 * A comment as readers see it: by pseudonym, never the username or account id. Comments travel
 * with the post to other groups, so anything here reaches people outside the writer's group.
 */
function commentOut(
  c: { id: string; postId: string; userId: string; content: string; createdAt: Date; user: { pseudonym: string } },
  readerId: string,
) {
  return { id: c.id, postId: c.postId, content: c.content, createdAt: c.createdAt, author: c.user.pseudonym, mine: c.userId === readerId };
}

export default router;
