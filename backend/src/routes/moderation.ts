/**
 * Reporting and blocking, for members (mounted at /api).
 *
 * - A member reports a post, comment or chat message they can see; the admin acts on it in the
 *   admin page's Reports tab (routes/admin.ts).
 * - A member blocks the writer of a post, comment or chat message: from then on they no longer
 *   see that member's posts, comments or chat (`notBlockedBy`). The blocked member is not told.
 *
 * Members never learn another member's account id: they pick what to report or block by the
 * item, and their block list shows pseudonyms and the block's own id.
 */

import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { handle } from '../middleware/handle';
import { isGroupMember, postAccess } from '../services/accessService';

const router = Router();

export const REPORT_REASONS = ['harassment', 'hate', 'violence', 'sexual', 'personal_info', 'spam', 'other'] as const;
type ReportReason = (typeof REPORT_REASONS)[number];

const TARGET_TYPES = ['post', 'comment', 'chat'] as const;
type TargetType = (typeof TARGET_TYPES)[number];

const DETAIL_MAX = 500;

/** Leaves out what a member wrote when the reader has blocked them. For `where` on a user relation. */
export function notBlockedBy(readerId: string): Prisma.UserWhereInput {
  return { blockedBy: { none: { blockerId: readerId } } };
}

interface Target {
  authorId: string;
  /** What the reader sees of it: a post's redacted version, a comment's or message's text. */
  content: string;
}

/**
 * The item, if the reader can see it: a post in one of their groups or on the common page, a
 * comment on such a post, or a message in their group's chat. Anything else is "not found", so
 * this cannot be used to learn what exists.
 */
async function visibleTarget(type: TargetType, id: string, readerId: string): Promise<Target | null> {
  if (type === 'post') {
    const post = await prisma.post.findUnique({
      where: { id },
      select: { id: true, ocUserId: true, redactedContent: true, listedAt: true, hiddenAt: true, unlistedAt: true },
    });
    if (!post) return null;
    const listed = !!post.listedAt && !post.hiddenAt && !post.unlistedAt;
    if (!listed && !(await postAccess(post, readerId)).canRead) return null;
    return { authorId: post.ocUserId, content: post.redactedContent };
  }
  if (type === 'comment') {
    const comment = await prisma.comment.findUnique({
      where: { id },
      select: { userId: true, content: true, post: { select: { id: true, ocUserId: true } } },
    });
    if (!comment || !(await postAccess(comment.post, readerId)).canRead) return null;
    return { authorId: comment.userId, content: comment.content };
  }
  const message = await prisma.chatMessage.findUnique({ where: { id }, select: { userId: true, groupId: true, content: true } });
  if (!message || !(await isGroupMember(message.groupId, readerId))) return null;
  return { authorId: message.userId, content: message.content };
}

/** Reads `targetType` and `targetId` from the body, answering 400/404 itself when they don't do. */
async function readTarget(req: AuthRequest, res: Response): Promise<(Target & { type: TargetType; id: string }) | null> {
  const { targetType, targetId } = (req.body ?? {}) as { targetType?: unknown; targetId?: unknown };
  if (!TARGET_TYPES.includes(targetType as TargetType) || typeof targetId !== 'string' || !targetId || targetId.length > 64) {
    res.status(400).json({ error: 'targetType must be post, comment or chat, with its targetId' });
    return null;
  }
  const target = await visibleTarget(targetType as TargetType, targetId, req.userId!);
  if (!target) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return { ...target, type: targetType as TargetType, id: targetId };
}

async function block(blockerId: string, blockedId: string): Promise<void> {
  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    create: { blockerId, blockedId },
    update: {},
  });
}

// POST /api/reports — {targetType, targetId, reason, detail?, block?}. Reporting the same item
// twice changes nothing. With `block: true` the writer is blocked as well.
router.post('/reports', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { reason, detail, block: alsoBlock } = (req.body ?? {}) as { reason?: unknown; detail?: unknown; block?: unknown };
  if (!REPORT_REASONS.includes(reason as ReportReason)) {
    res.status(400).json({ error: `reason must be one of: ${REPORT_REASONS.join(', ')}` });
    return;
  }
  const note = typeof detail === 'string' ? detail.trim() : '';
  if (note.length > DETAIL_MAX) {
    res.status(400).json({ error: `detail must be at most ${DETAIL_MAX} characters` });
    return;
  }
  const target = await readTarget(req, res);
  if (!target) return;
  if (target.authorId === userId) {
    res.status(400).json({ error: 'You cannot report what you wrote yourself.' });
    return;
  }
  const where = { reporterId_targetType_targetId: { reporterId: userId, targetType: target.type, targetId: target.id } };
  const already = await prisma.report.findUnique({ where, select: { id: true } });
  if (!already) {
    await prisma.report.create({
      data: {
        reporterId: userId,
        authorId: target.authorId,
        targetType: target.type,
        targetId: target.id,
        reason: reason as ReportReason,
        detail: note || null,
        content: target.content,
      },
    });
  }
  if (alsoBlock === true) await block(userId, target.authorId);
  res.status(already ? 200 : 201).json({ ok: true, alreadyReported: !!already, blocked: alsoBlock === true });
}));

// POST /api/blocks — {targetType, targetId}: blocks whoever wrote it.
router.post('/blocks', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const target = await readTarget(req, res);
  if (!target) return;
  if (target.authorId === req.userId) {
    res.status(400).json({ error: 'You cannot block yourself.' });
    return;
  }
  await block(req.userId!, target.authorId);
  const author = await prisma.user.findUniqueOrThrow({ where: { id: target.authorId }, select: { pseudonym: true } });
  res.status(201).json({ ok: true, author: author.pseudonym });
}));

// GET /api/blocks — the members the caller has blocked, by pseudonym, newest first.
router.get('/blocks', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const blocks = await prisma.block.findMany({
    where: { blockerId: req.userId! },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, blocked: { select: { pseudonym: true } } },
  });
  res.json(blocks.map((b) => ({ id: b.id, author: b.blocked.pseudonym, createdAt: b.createdAt })));
}));

// DELETE /api/blocks/:id — unblocks; only the caller's own blocks.
router.delete('/blocks/:id', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const removed = await prisma.block.deleteMany({ where: { id: req.params.id, blockerId: req.userId! } });
  if (removed.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ ok: true });
}));

export default router;
