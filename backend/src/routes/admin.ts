/**
 * The admin page's API (/api/admin), for ProMic's admins only (services/adminAuth.ts). Admins
 * see everything: original posts and which account wrote each one. Everything they change is
 * written to AdminAction, shown on the page's log.
 */

import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { handle } from '../middleware/handle';
import { AdminRequest, requireAdmin } from '../services/adminAuth';
import { fingerprintOf } from '../services/contactService';
import { groupMinMembers, sweepPushes } from '../services/groupService';
import { recalculateGroupWeight } from '../services/groupWeightService';
import { indiaDay } from '../services/groupWeight';
import { promicConfigured, promicDb } from '../services/promicService';
import { recalculateEverything } from '../services/pushSweep';
import { recalculateAllSpreads } from '../services/spreadService';
import { RULES, RuleKey, allRules, isRuleKey, ruleError, rule, setRule } from '../services/settings';
import { ON_COMMON_PAGE } from './common';

const router = Router();
router.use(requireAdmin);

const PAGE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const LE_BASE = process.env.PROMIC_LE_URL ?? 'https://asia-south1-promic-c5567.cloudfunctions.net';

function offsetOf(req: AdminRequest): number {
  return Math.max(0, Math.floor(Number(req.query.offset) || 0));
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Records what an admin did. */
async function log(req: AdminRequest, action: string, targetType: string, targetId: string, detail?: string) {
  await prisma.adminAction.create({
    data: {
      adminUid: req.admin!.uid,
      adminEmail: req.admin!.email,
      action,
      targetType,
      targetId,
      detail: detail ? detail.slice(0, 500) : null,
    },
  });
}

function snippet(content: string, length = 80): string {
  const line = content.replace(/\s+/g, ' ').trim();
  return line.length > length ? `${line.slice(0, length)}…` : line;
}

/** Closes the open member reports about an item (routes/moderation.ts), as `resolution`. */
async function resolveReports(req: AdminRequest, targetType: string, targetId: string, resolution: 'removed' | 'dismissed') {
  const done = await prisma.report.updateMany({
    where: { targetType, targetId, resolvedAt: null },
    data: { resolvedAt: new Date(), resolution, resolvedBy: req.admin!.email },
  });
  return done.count;
}

// ── Who is signed in ────────────────────────────────────────────────────────────────────────

router.get('/me', (req: AdminRequest, res: Response) => {
  res.json(req.admin);
});

// ── Dashboard ───────────────────────────────────────────────────────────────────────────────

router.get('/overview', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const now = Date.now();
  const weekAgo = new Date(now - 7 * DAY_MS);
  const days = Array.from({ length: 14 }, (_, i) => indiaDay(new Date(now - (13 - i) * DAY_MS)));
  const seriesStart = new Date(now - 14 * DAY_MS);

  const [
    users, newUsers, suspended, noContact,
    groupSizes,
    posts, newPosts, hidden, onCommon, unlisted,
    comments, chat, votes, firstLooks,
    activeToday, activeWeek,
    recentUsers, recentPosts, activeByDay,
    recentActions,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { suspendedAt: { not: null } } }),
    prisma.user.count({ where: { OR: [{ emailHash: null }, { phoneHash: null }] } }),
    prisma.groupMember.groupBy({ by: ['groupId'], _count: { _all: true } }),
    prisma.post.count(),
    prisma.post.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.post.count({ where: { hiddenAt: { not: null } } }),
    prisma.post.count({ where: ON_COMMON_PAGE }),
    prisma.post.count({ where: { unlistedAt: { not: null } } }),
    prisma.comment.count(),
    prisma.chatMessage.count(),
    prisma.pushVote.count(),
    prisma.viewRecord.count({ where: { viewedAt: { gte: weekAgo } } }),
    prisma.userActiveDay.count({ where: { day: days[13] } }),
    prisma.userActiveDay.groupBy({ by: ['userId'], where: { day: { gte: days[7] } } }),
    prisma.user.findMany({ where: { createdAt: { gte: seriesStart } }, select: { createdAt: true } }),
    prisma.post.findMany({ where: { createdAt: { gte: seriesStart } }, select: { createdAt: true } }),
    prisma.userActiveDay.groupBy({ by: ['day'], where: { day: { gte: days[0] } }, _count: { _all: true } }),
    prisma.adminAction.findMany({ orderBy: { at: 'desc' }, take: 8 }),
  ]);
  const groups = await prisma.group.count();
  const openReports = await prisma.report.count({ where: { resolvedAt: null } });

  const countBy = (dates: Date[]) => {
    const counts = new Map<string, number>();
    for (const d of dates) counts.set(indiaDay(d), (counts.get(indiaDay(d)) ?? 0) + 1);
    return counts;
  };
  const joined = countBy(recentUsers.map((u) => u.createdAt));
  const posted = countBy(recentPosts.map((p) => p.createdAt));
  const active = new Map(activeByDay.map((a) => [a.day, a._count._all]));

  res.json({
    users: { total: users, newThisWeek: newUsers, suspended, withoutContact: noContact, activeToday, activeThisWeek: activeWeek.length },
    groups: { total: groups, takingPosts: groupSizes.filter((g) => g._count._all >= groupMinMembers()).length },
    posts: { total: posts, newThisWeek: newPosts, hidden, onCommonPage: onCommon, unlisted },
    activity: { comments, chatMessages: chat, votes, firstLooksThisWeek: firstLooks },
    reports: { open: openReports },
    days: days.map((day) => ({ day, joined: joined.get(day) ?? 0, posted: posted.get(day) ?? 0, active: active.get(day) ?? 0 })),
    recentActions,
  });
}));

// ── Accounts ────────────────────────────────────────────────────────────────────────────────

const USER_FIELDS = {
  id: true,
  username: true,
  pseudonym: true,
  createdAt: true,
  weight: true,
  suspendedAt: true,
  suspendedReason: true,
  emailHash: true,
  phoneHash: true,
  groupMemberships: { select: { group: { select: { id: true, name: true } } } },
  _count: { select: { posts: true, comments: true, pushVotes: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_FIELDS }>;

function userOut({ emailHash, phoneHash, groupMemberships, ...user }: UserRow) {
  return {
    ...user,
    // Only fingerprints are kept, never the email address or number itself.
    hasEmail: !!emailHash,
    hasPhone: !!phoneHash,
    groups: groupMemberships.map((m) => m.group),
  };
}

// GET /users?q=&filter=all|suspended&offset= — q: part of a username or pseudonym, or a whole
// email address or mobile number (matched by its fingerprint).
router.get('/users', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const q = text(req.query.q, 200);
  const or: Prisma.UserWhereInput[] = [];
  if (q) {
    or.push({ username: { contains: q, mode: 'insensitive' } }, { pseudonym: { contains: q, mode: 'insensitive' } });
    const email = q.includes('@') ? fingerprintOf('email', q) : null;
    const phone = /\d{6,}/.test(q) ? fingerprintOf('phone', q) : null;
    if (email) or.push({ emailHash: email });
    if (phone) or.push({ phoneHash: phone });
  }
  const where: Prisma.UserWhereInput = {
    ...(or.length ? { OR: or } : {}),
    ...(req.query.filter === 'suspended' ? { suspendedAt: { not: null } } : {}),
  };
  const offset = offsetOf(req);
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: PAGE, select: USER_FIELDS }),
    prisma.user.count({ where }),
  ]);
  res.json({ total, offset, users: users.map(userOut) });
}));

router.get('/users/:id', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      ...USER_FIELDS,
      activityScore: true,
      postScore: true,
      voteScore: true,
      tokensValidFrom: true,
      proMicLink: { select: { linkedAt: true } },
      groupMemberships: {
        select: { joinedAt: true, lastSeenAt: true, visitCount: true, group: { select: { id: true, name: true } } },
      },
      _count: { select: { posts: true, comments: true, pushVotes: true, chatMessages: true, viewRecords: true } },
    },
  });
  if (!user) {
    res.status(404).json({ error: 'No such account' });
    return;
  }
  const [posts, activeDays] = await Promise.all([
    prisma.post.findMany({
      where: { ocUserId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, originalContent: true, createdAt: true, hiddenAt: true, listedAt: true, unlistedAt: true, reachedGroups: true, eligibleGroups: true },
    }),
    prisma.userActiveDay.findMany({ where: { userId: user.id }, orderBy: { day: 'desc' }, take: 30, select: { day: true, seconds: true } }),
  ]);
  const { emailHash, phoneHash, groupMemberships, proMicLink, ...rest } = user;
  res.json({
    ...rest,
    hasEmail: !!emailHash,
    hasPhone: !!phoneHash,
    proMicLinked: !!proMicLink,
    memberships: groupMemberships,
    posts: posts.map(({ originalContent, ...p }) => ({ ...p, snippet: snippet(originalContent) })),
    activeDays,
  });
}));

router.post('/users/:id/suspend', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const reason = text(req.body?.reason, 300);
  const found = await prisma.user.updateMany({
    where: { id: req.params.id },
    // Signs every device out too.
    data: { suspendedAt: new Date(), suspendedReason: reason || null, tokensValidFrom: new Date() },
  });
  if (found.count === 0) {
    res.status(404).json({ error: 'No such account' });
    return;
  }
  await log(req, 'user.suspend', 'user', req.params.id, reason);
  res.json({ ok: true });
}));

router.post('/users/:id/restore', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const found = await prisma.user.updateMany({ where: { id: req.params.id }, data: { suspendedAt: null, suspendedReason: null } });
  if (found.count === 0) {
    res.status(404).json({ error: 'No such account' });
    return;
  }
  await log(req, 'user.restore', 'user', req.params.id);
  res.json({ ok: true });
}));

router.post('/users/:id/signout', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const found = await prisma.user.updateMany({ where: { id: req.params.id }, data: { tokensValidFrom: new Date() } });
  if (found.count === 0) {
    res.status(404).json({ error: 'No such account' });
    return;
  }
  await log(req, 'user.signout', 'user', req.params.id);
  res.json({ ok: true });
}));

// DELETE /users/:id — the account and everything it wrote: posts, comments, chat, votes.
router.delete('/users/:id', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, username: true } });
  if (!user) {
    res.status(404).json({ error: 'No such account' });
    return;
  }
  await prisma.$transaction([
    prisma.post.deleteMany({ where: { ocUserId: user.id } }),
    prisma.user.delete({ where: { id: user.id } }),
  ]);
  await log(req, 'user.delete', 'user', user.id, `username ${user.username}`);
  void recalculateAllSpreads();
  res.json({ ok: true });
}));

// ── Posts and comments ──────────────────────────────────────────────────────────────────────

const POST_FIELDS = {
  id: true,
  originalContent: true,
  redactedContent: true,
  category: true,
  createdAt: true,
  totalWeight: true,
  cycle: true,
  reachedGroups: true,
  eligibleGroups: true,
  spreadScore: true,
  listedAt: true,
  unlistedAt: true,
  hiddenAt: true,
  hiddenReason: true,
  lastManualPushAt: true,
  oc: { select: { id: true, username: true, pseudonym: true } },
  placements: { select: { group: { select: { id: true, name: true } } } },
  _count: { select: { comments: true, pushVotes: true, viewRecords: true, history: true } },
} satisfies Prisma.PostSelect;

type PostRow = Prisma.PostGetPayload<{ select: typeof POST_FIELDS }>;

function postOut({ placements, oc, ...post }: PostRow) {
  return {
    ...post,
    author: oc,
    groups: placements.map((p) => p.group),
    onCommonPage: !!post.listedAt && !post.hiddenAt && !post.unlistedAt,
  };
}

// GET /posts?filter=all|hidden|common|unlisted&q=&offset= — q: words in the post, or the author's
// username or pseudonym. "common" is the common page, in its order.
router.get('/posts', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const q = text(req.query.q, 200);
  const filter = String(req.query.filter ?? 'all');
  const where: Prisma.PostWhereInput = {
    ...(q
      ? {
        OR: [
          { originalContent: { contains: q, mode: 'insensitive' } },
          { oc: { username: { contains: q, mode: 'insensitive' } } },
          { oc: { pseudonym: { contains: q, mode: 'insensitive' } } },
        ],
      }
      : {}),
    ...(filter === 'hidden' ? { hiddenAt: { not: null } } : {}),
    ...(filter === 'common' ? ON_COMMON_PAGE : {}),
    ...(filter === 'unlisted' ? { unlistedAt: { not: null } } : {}),
  };
  const orderBy: Prisma.PostOrderByWithRelationInput[] = filter === 'common'
    ? [{ spreadScore: 'desc' }, { listedAt: 'asc' }, { id: 'asc' }]
    : [{ createdAt: 'desc' }];
  const offset = offsetOf(req);
  const [posts, total] = await Promise.all([
    prisma.post.findMany({ where, orderBy, skip: offset, take: PAGE, select: POST_FIELDS }),
    prisma.post.count({ where }),
  ]);
  res.json({ total, offset, posts: posts.map(postOut) });
}));

router.get('/posts/:id', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: POST_FIELDS });
  if (!post) {
    res.status(404).json({ error: 'No such post' });
    return;
  }
  const [comments, history] = await Promise.all([
    prisma.comment.findMany({
      where: { postId: post.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, createdAt: true, user: { select: { id: true, username: true, pseudonym: true } } },
    }),
    prisma.postHistory.findMany({
      where: { postId: post.id },
      orderBy: { arrivedAt: 'asc' },
      select: { arrivedAt: true, movedAt: true, pushPercentage: true, wasManualPush: true, group: { select: { id: true, name: true } } },
    }),
  ]);
  res.json({ ...postOut(post), comments, history });
}));

async function setPost(req: AdminRequest, res: Response, data: Prisma.PostUpdateManyMutationInput, action: string, detail?: string) {
  const found = await prisma.post.updateMany({ where: { id: req.params.id }, data });
  if (found.count === 0) {
    res.status(404).json({ error: 'No such post' });
    return;
  }
  await log(req, action, 'post', req.params.id, detail);
  res.json({ ok: true });
}

router.post('/posts/:id/hide', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const reason = text(req.body?.reason, 300);
  await setPost(req, res, { hiddenAt: new Date(), hiddenReason: reason || null }, 'post.hide', reason);
  await resolveReports(req, 'post', req.params.id, 'removed');
}));

router.post('/posts/:id/unhide', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  await setPost(req, res, { hiddenAt: null, hiddenReason: null }, 'post.unhide');
}));

// Off the common page only; the post goes on travelling between groups.
router.post('/posts/:id/unlist', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  await setPost(req, res, { unlistedAt: new Date() }, 'post.unlist');
}));

router.post('/posts/:id/relist', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  await setPost(req, res, { unlistedAt: null }, 'post.relist');
}));

router.delete('/posts/:id', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, originalContent: true } });
  if (!post) {
    res.status(404).json({ error: 'No such post' });
    return;
  }
  await prisma.post.delete({ where: { id: post.id } });
  await log(req, 'post.delete', 'post', post.id, snippet(post.originalContent));
  await resolveReports(req, 'post', post.id, 'removed');
  res.json({ ok: true });
}));

router.delete('/comments/:id', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const comment = await prisma.comment.findUnique({ where: { id: req.params.id }, select: { id: true, content: true, postId: true } });
  if (!comment) {
    res.status(404).json({ error: 'No such comment' });
    return;
  }
  await prisma.comment.delete({ where: { id: comment.id } });
  await log(req, 'comment.delete', 'comment', comment.id, `on post ${comment.postId}: ${snippet(comment.content)}`);
  await resolveReports(req, 'comment', comment.id, 'removed');
  res.json({ ok: true });
}));

// GET /chat?groupId=&offset= — group chat, newest first.
router.get('/chat', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const groupId = text(req.query.groupId, 64);
  const where: Prisma.ChatMessageWhereInput = groupId ? { groupId } : {};
  const offset = offsetOf(req);
  const [messages, total] = await Promise.all([
    prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: PAGE,
      select: {
        id: true, content: true, createdAt: true,
        user: { select: { id: true, username: true, pseudonym: true } },
        group: { select: { id: true, name: true } },
      },
    }),
    prisma.chatMessage.count({ where }),
  ]);
  res.json({ total, offset, messages });
}));

router.delete('/chat/:id', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const message = await prisma.chatMessage.findUnique({ where: { id: req.params.id }, select: { id: true, content: true, groupId: true } });
  if (!message) {
    res.status(404).json({ error: 'No such message' });
    return;
  }
  await prisma.chatMessage.delete({ where: { id: message.id } });
  await log(req, 'chat.delete', 'chat', message.id, `in group ${message.groupId}: ${snippet(message.content)}`);
  await resolveReports(req, 'chat', message.id, 'removed');
  res.json({ ok: true });
}));

// ── Reports from members ────────────────────────────────────────────────────────────────────

const PERSON = { select: { id: true, username: true, pseudonym: true } } as const;

// GET /reports?status=open|resolved — members' reports (routes/moderation.ts), one entry per
// reported item with every report about it. Open: the most reported first, then the oldest.
router.get('/reports', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const resolved = req.query.status === 'resolved';
  const reports = await prisma.report.findMany({
    where: { resolvedAt: resolved ? { not: null } : null },
    orderBy: { createdAt: resolved ? 'desc' : 'asc' },
    take: 500,
    select: {
      id: true, targetType: true, targetId: true, reason: true, detail: true, content: true, createdAt: true,
      resolvedAt: true, resolution: true, resolvedBy: true,
      reporter: PERSON,
      author: { select: { id: true, username: true, pseudonym: true, suspendedAt: true } },
    },
  });

  const idsOf = (type: string) => [...new Set(reports.filter((r) => r.targetType === type).map((r) => r.targetId))];
  const [posts, comments, messages] = await Promise.all([
    prisma.post.findMany({ where: { id: { in: idsOf('post') } }, select: { id: true, hiddenAt: true } }),
    prisma.comment.findMany({ where: { id: { in: idsOf('comment') } }, select: { id: true, postId: true } }),
    prisma.chatMessage.findMany({ where: { id: { in: idsOf('chat') } }, select: { id: true, groupId: true } }),
  ]);
  const postsById = new Map(posts.map((p) => [p.id, p]));
  const commentsById = new Map(comments.map((c) => [c.id, c]));
  const messagesById = new Map(messages.map((m) => [m.id, m]));

  type Row = (typeof reports)[number];
  type Item = {
    targetType: string; targetId: string; content: string; author: Row['author'];
    /** Still there; for a post, whether it is hidden; where a comment or message is. */
    exists: boolean; hidden: boolean; postId: string | null; groupId: string | null;
    resolution: string | null; resolvedAt: Date | null; resolvedBy: string | null;
    reports: { id: string; reason: string; detail: string | null; createdAt: Date; reporter: Row['reporter'] }[];
  };
  const items = new Map<string, Item>();
  for (const r of reports) {
    const key = `${r.targetType}:${r.targetId}`;
    let item = items.get(key);
    if (!item) {
      const post = r.targetType === 'post' ? postsById.get(r.targetId) : undefined;
      const comment = r.targetType === 'comment' ? commentsById.get(r.targetId) : undefined;
      const message = r.targetType === 'chat' ? messagesById.get(r.targetId) : undefined;
      item = {
        targetType: r.targetType,
        targetId: r.targetId,
        content: r.content,
        author: r.author,
        exists: !!(post ?? comment ?? message),
        hidden: !!post?.hiddenAt,
        postId: post?.id ?? comment?.postId ?? null,
        groupId: message?.groupId ?? null,
        resolution: r.resolution,
        resolvedAt: r.resolvedAt,
        resolvedBy: r.resolvedBy,
        reports: [],
      };
      items.set(key, item);
    }
    item.reports.push({ id: r.id, reason: r.reason, detail: r.detail, createdAt: r.createdAt, reporter: r.reporter });
  }
  const list = [...items.values()];
  if (!resolved) {
    list.sort((a, b) => b.reports.length - a.reports.length
      || a.reports[0].createdAt.getTime() - b.reports[0].createdAt.getTime());
  }
  res.json({ items: list });
}));

// POST /reports/resolve — {targetType, targetId, action: "remove" | "dismiss", reason?}. Remove
// hides a post (as Hide does) or deletes a comment or chat message; either way every open report
// about the item is closed.
router.post('/reports/resolve', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const targetType = text(req.body?.targetType, 16);
  const targetId = text(req.body?.targetId, 64);
  const action = req.body?.action;
  const reason = text(req.body?.reason, 300);
  if (!['post', 'comment', 'chat'].includes(targetType) || !targetId || (action !== 'remove' && action !== 'dismiss')) {
    res.status(400).json({ error: 'targetType (post, comment or chat), targetId and action (remove or dismiss) are needed' });
    return;
  }
  const open = await prisma.report.count({ where: { targetType, targetId, resolvedAt: null } });
  if (open === 0) {
    res.status(404).json({ error: 'No open report about this' });
    return;
  }
  if (action === 'remove') {
    if (targetType === 'post') {
      await prisma.post.updateMany({
        where: { id: targetId, hiddenAt: null },
        data: { hiddenAt: new Date(), hiddenReason: reason || 'Reported by members' },
      });
    } else if (targetType === 'comment') {
      await prisma.comment.deleteMany({ where: { id: targetId } });
    } else {
      await prisma.chatMessage.deleteMany({ where: { id: targetId } });
    }
  }
  const closed = await resolveReports(req, targetType, targetId, action === 'remove' ? 'removed' : 'dismissed');
  await log(req, `report.${action}`, targetType, targetId, reason || `${closed} report${closed === 1 ? '' : 's'}`);
  res.json({ ok: true, closed });
}));

// ── Groups ──────────────────────────────────────────────────────────────────────────────────

router.get('/groups', handle(async (_req: AdminRequest, res: Response): Promise<void> => {
  const groups = await prisma.group.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, createdAt: true, trustScore: true, loginScore: true, reviewScore: true, weightUpdatedAt: true,
      _count: { select: { members: true, placements: true, chatMessages: true } },
    },
  });
  res.json({ minMembers: groupMinMembers(), maxMembers: rule('groupMaxMembers'), groups });
}));

router.get('/groups/:id', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, name: true, createdAt: true, trustScore: true, loginScore: true, reviewScore: true, weightUpdatedAt: true,
      members: {
        orderBy: { joinedAt: 'asc' },
        select: {
          joinedAt: true, lastSeenAt: true, visitCount: true, totalTimeSpent: true, readThroughCount: true,
          user: { select: { id: true, username: true, pseudonym: true, weight: true, suspendedAt: true } },
        },
      },
      placements: {
        select: { arrivedAt: true, post: { select: { id: true, originalContent: true, hiddenAt: true, oc: { select: { username: true, pseudonym: true } } } } },
      },
    },
  });
  if (!group) {
    res.status(404).json({ error: 'No such group' });
    return;
  }
  const { placements, ...rest } = group;
  res.json({
    ...rest,
    posts: placements.map(({ arrivedAt, post: { originalContent, ...post } }) => ({ ...post, arrivedAt, snippet: snippet(originalContent) })),
  });
}));

router.patch('/groups/:id', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const name = text(req.body?.name, 40);
  if (name.length < 2) {
    res.status(400).json({ error: 'A name of 2 to 40 characters is required.' });
    return;
  }
  const group = await prisma.group.findUnique({ where: { id: req.params.id }, select: { name: true } });
  if (!group) {
    res.status(404).json({ error: 'No such group' });
    return;
  }
  await prisma.group.update({ where: { id: req.params.id }, data: { name } });
  await log(req, 'group.rename', 'group', req.params.id, `${group.name} → ${name}`);
  res.json({ ok: true });
}));

// POST /groups/:id/move { userId, toGroupId } — moves a member of this group to another one.
// Their votes in this group are dropped; posts here stay here.
router.post('/groups/:id/move', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const from = req.params.id;
  const userId = text(req.body?.userId, 64);
  const to = text(req.body?.toGroupId, 64);
  if (!userId || !to || to === from) {
    res.status(400).json({ error: 'userId and a different toGroupId are required.' });
    return;
  }
  const [membership, target, already, targetSize] = await Promise.all([
    prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: from, userId } }, select: { id: true } }),
    prisma.group.findUnique({ where: { id: to }, select: { id: true, name: true } }),
    prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: to, userId } }, select: { id: true } }),
    prisma.groupMember.count({ where: { groupId: to } }),
  ]);
  if (!membership) {
    res.status(404).json({ error: 'That account is not a member of this group.' });
    return;
  }
  if (!target) {
    res.status(404).json({ error: 'No such target group.' });
    return;
  }
  if (already) {
    res.status(409).json({ error: 'That account is already a member of the target group.' });
    return;
  }
  if (targetSize >= rule('groupMaxMembers')) {
    res.status(409).json({ error: 'The target group is full.' });
    return;
  }
  await prisma.$transaction([
    prisma.pushVote.deleteMany({ where: { groupId: from, userId } }),
    prisma.groupMember.update({
      where: { id: membership.id },
      data: { groupId: to, joinedAt: new Date(), lastSeenAt: null, visitCount: 0, totalTimeSpent: 0, readThroughCount: 0 },
    }),
  ]);
  await log(req, 'group.move', 'user', userId, `from group ${from} to ${target.name}`);
  void Promise.all([recalculateGroupWeight(from), recalculateGroupWeight(to)])
    .then(() => sweepPushes())
    .then(() => recalculateAllSpreads())
    .catch((err) => console.error('After a move:', err));
  res.json({ ok: true });
}));

// POST /recalculate — the hourly run now: pushes due, group and member weights, spreads.
router.post('/recalculate', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  await recalculateEverything();
  await log(req, 'recalculate', 'setting', 'all');
  res.json({ ok: true });
}));

// ── Settings ────────────────────────────────────────────────────────────────────────────────

router.get('/settings', handle(async (_req: AdminRequest, res: Response): Promise<void> => {
  const stored = new Map((await prisma.setting.findMany()).map((s) => [s.key, s]));
  const values = allRules();
  res.json((Object.keys(RULES) as RuleKey[]).map((key) => ({
    key,
    ...RULES[key],
    value: values[key],
    updatedAt: stored.get(key)?.updatedAt ?? null,
    updatedBy: stored.get(key)?.updatedBy ?? null,
  })));
}));

router.put('/settings/:key', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const { key } = req.params;
  if (!isRuleKey(key)) {
    res.status(404).json({ error: 'No such setting' });
    return;
  }
  const value = Number(req.body?.value);
  const problem = ruleError(key, value, allRules());
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const old = await setRule(key, value, req.admin!.email);
  await log(req, 'setting.change', 'setting', key, `${old} → ${value}`);
  // Group sizes and thresholds change which posts move and which are listed.
  if (key !== 'registrationOpen' && key !== 'manualPushCooldownHours') {
    recalculateEverything().catch((err) => console.error('After a setting change:', err));
  }
  res.json({ ok: true });
}));

// ── Log ─────────────────────────────────────────────────────────────────────────────────────

router.get('/log', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const offset = offsetOf(req);
  const [actions, total] = await Promise.all([
    prisma.adminAction.findMany({ orderBy: { at: 'desc' }, skip: offset, take: PAGE }),
    prisma.adminAction.count(),
  ]);
  res.json({ total, offset, actions });
}));

// ── Officers (ProMic law-enforcement accounts) ──────────────────────────────────────────────
// Kept in ProMic's database. Listing reads it with the service account; creating, new
// passwords and turning accounts off go through ProMic's own admin functions (functions/le.js)
// with the admin's sign-in, so ProMic sends the emails and keeps its own audit.

const NOT_CONFIGURED = 'ProMic is not set up on this server, so officer accounts cannot be managed here.';

router.get('/officers', handle(async (_req: AdminRequest, res: Response): Promise<void> => {
  if (!promicConfigured()) {
    res.status(503).json({ error: NOT_CONFIGURED });
    return;
  }
  const snap = await promicDb().ref('le_users').get();
  const all = (snap.val() ?? {}) as Record<string, Record<string, unknown>>;
  const officers = Object.entries(all).map(([id, o]) => ({
    id,
    // Never the password hash, salt or codes.
    email: typeof o.email === 'string' ? o.email : '',
    phone: typeof o.phone === 'string' ? o.phone : '',
    branch: typeof o.branch === 'string' ? o.branch : '',
    disabled: o.disabled === true,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : null,
    lastLoginAt: typeof o.lastLoginAt === 'number' ? o.lastLoginAt : null,
    passwordIssuedAt: typeof o.passwordIssuedAt === 'number' ? o.passwordIssuedAt : null,
    lockedUntil: typeof o.lockedUntil === 'number' && o.lockedUntil > Date.now() ? o.lockedUntil : null,
    hasStation: !!o.station,
  }));
  officers.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  res.json(officers);
}));

async function promicAdmin(req: AdminRequest, res: Response, fn: string, body: Record<string, unknown>): Promise<boolean> {
  const answer = await fetch(`${LE_BASE}/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${req.adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!answer) {
    res.status(502).json({ error: 'ProMic could not be reached.' });
    return false;
  }
  const data = (await answer.json().catch(() => ({}))) as { error?: string };
  if (!answer.ok) {
    res.status(answer.status).json({ error: data.error ?? 'ProMic refused the request.' });
    return false;
  }
  res.json(data);
  return true;
}

// POST /officers { email, phone, branch } — ProMic emails the new officer their password.
router.post('/officers', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const email = text(req.body?.email, 200);
  const phone = text(req.body?.phone, 40);
  const branch = text(req.body?.branch, 120);
  if (await promicAdmin(req, res, 'adminCreateLeUser', { email, phone, branch })) {
    await log(req, 'officer.create', 'officer', email, branch);
  }
}));

// POST /officers/reset { email } — a new password, emailed by ProMic.
router.post('/officers/reset', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const email = text(req.body?.email, 200);
  if (await promicAdmin(req, res, 'adminCreateLeUser', { email, reset: true })) {
    await log(req, 'officer.reset', 'officer', email);
  }
}));

router.post('/officers/:id/disabled', handle(async (req: AdminRequest, res: Response): Promise<void> => {
  const disabled = req.body?.disabled === true;
  if (await promicAdmin(req, res, 'adminSetLeUserDisabled', { leId: req.params.id, disabled })) {
    await log(req, disabled ? 'officer.disable' : 'officer.enable', 'officer', req.params.id);
  }
}));

export default router;
