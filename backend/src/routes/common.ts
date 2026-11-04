import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { handle } from '../middleware/handle';
import { Officer, officerFor } from '../services/officerAuth';
import { notBlockedBy } from './moderation';
import { isCategory } from '../services/categories';
import { openContact } from '../services/contactService';
import { isPoliceComplaint } from '../services/policeComplaint';

const router = Router();

const PAGE_SIZE = 30;

export const ON_COMMON_PAGE = { listedAt: { not: null }, hiddenAt: null, unlistedAt: null };

const SELECT = {
  id: true,
  redactedContent: true,
  category: true,
  subcategory: true,
  createdAt: true,
  listedAt: true,
  reachedGroups: true,
  eligibleGroups: true,
  spreadScore: true,
  totalWeight: true,
} as const;

/**
 * One page of the common page: every post that has reached 20% of the eligible groups
 * (services/spread.ts; an admin can change the share), fastest spreading first, less any an
 * admin hid or unlisted. `?category=` keeps only posts of that type of threat
 * (services/categories.ts); anything else lists them all.
 */
async function page<S extends Prisma.PostSelect>(req: Request, select: S, where: Prisma.PostWhereInput) {
  const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
  if (isCategory(req.query.category)) where.category = req.query.category;
  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: [{ spreadScore: 'desc' }, { listedAt: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: PAGE_SIZE,
      select,
    }),
    prisma.post.count({ where }),
  ]);
  return { total, offset, posts };
}

function listing(post: { listedAt: Date | null; createdAt: Date }, rank: number) {
  // How long it took to reach the listing share of the groups.
  return { rank, listedAfterMs: post.listedAt!.getTime() - post.createdAt.getTime() };
}

// GET /api/common — for every registered member: the redacted versions, each tagged with its
// author's pseudonym, never the username.
router.get('/', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  // A member does not see posts by members they have blocked (routes/moderation.ts).
  const where: Prisma.PostWhereInput = { ...ON_COMMON_PAGE, oc: notBlockedBy(req.userId!) };
  const { total, offset, posts } = await page(req, { ...SELECT, oc: { select: { pseudonym: true } } }, where);
  res.json({
    total,
    offset,
    posts: posts.map(({ oc, ...post }, i) => ({ ...post, ...listing(post, offset + i + 1), author: oc.pseudonym })),
  });
}));

// Numbers are kept as "91" and ten digits (services/contactFormat.ts); officers get "+91…".
function dialable(normalized: string | null): string | null {
  return normalized ? `+${normalized}` : null;
}

async function officerOf(req: Request, res: Response): Promise<Officer | null> {
  const header = req.headers.authorization ?? '';
  const officer = await officerFor(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!officer) res.status(401).json({ error: 'Sign in again.' });
  return officer;
}

/**
 * GET /api/common/officer — for a signed-in officer (ProMic session token). Each post in full:
 * the exact words as well as the redacted version, the author's pseudonym and their mobile
 * number as "+91…" (null when the account has none on record). Except a complaint about the police
 * (services/policeComplaint.ts): `protected: true`, the redacted version only, and `request`,
 * this officer's request for the rest (null, "pending", "granted" or "refused"). Once the author
 * grants it, the rest is given to that officer.
 */
router.get('/officer', handle(async (req: Request, res: Response): Promise<void> => {
  const officer = await officerOf(req, res);
  if (!officer) return;
  const { total, offset, posts } = await page(req, {
    ...SELECT,
    originalContent: true,
    oc: { select: { pseudonym: true, phoneSealed: true } },
    officerRequests: { where: { officerId: officer.id }, select: { status: true } },
  }, { ...ON_COMMON_PAGE });
  res.json({
    total,
    offset,
    posts: posts.map(({ oc, officerRequests, originalContent, ...post }, i) => {
      const isProtected = isPoliceComplaint({ subcategory: post.subcategory, originalContent });
      const request = officerRequests[0]?.status ?? null;
      const shown = !isProtected || request === 'granted';
      return {
        ...post,
        ...listing(post, offset + i + 1),
        protected: isProtected,
        request: isProtected ? request : null,
        author: shown ? oc.pseudonym : null,
        ...(shown ? { originalContent, contactNumber: dialable(openContact(oc.phoneSealed)) } : {}),
      };
    }),
  });
}));

/**
 * POST /api/common/officer/:postId/request — an officer asks the author of a complaint about the
 * police for its exact words, pseudonym and mobile number. Once per post; a refusal stands.
 */
router.post('/officer/:postId/request', handle(async (req: Request, res: Response): Promise<void> => {
  const officer = await officerOf(req, res);
  if (!officer) return;
  const post = await prisma.post.findFirst({
    where: { id: req.params.postId, ...ON_COMMON_PAGE },
    select: { id: true, subcategory: true, originalContent: true },
  });
  if (!post) {
    res.status(404).json({ error: 'This post is not on the common page.' });
    return;
  }
  if (!isPoliceComplaint(post)) {
    res.status(400).json({ error: 'Nothing on this post is withheld from officers.' });
    return;
  }
  const request = await prisma.officerDetailRequest.upsert({
    where: { postId_officerId: { postId: post.id, officerId: officer.id } },
    create: { postId: post.id, officerId: officer.id, branch: officer.branch.slice(0, 200) },
    update: {},
    select: { status: true },
  });
  res.status(201).json({ request: request.status });
}));

export default router;
