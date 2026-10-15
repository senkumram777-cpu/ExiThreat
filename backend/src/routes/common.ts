import { Router, Request, Response } from 'express';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { handle } from '../middleware/handle';
import { officerFor } from '../services/officerAuth';

const router = Router();

const PAGE_SIZE = 30;

/**
 * The common page: every post that has reached 20% of the eligible groups (services/spread.ts),
 * fastest spreading first. Each is tagged with its author's pseudonym, never the username.
 * Members get the redacted version only; officers get the original as well.
 */
async function listed(req: Request, withOriginal: boolean) {
  const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where: { listedAt: { not: null } },
      orderBy: [{ spreadScore: 'desc' }, { listedAt: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: PAGE_SIZE,
      select: {
        id: true,
        redactedContent: true,
        originalContent: withOriginal,
        createdAt: true,
        listedAt: true,
        reachedGroups: true,
        eligibleGroups: true,
        spreadScore: true,
        totalWeight: true,
        oc: { select: { pseudonym: true } },
      },
    }),
    prisma.post.count({ where: { listedAt: { not: null } } }),
  ]);
  return {
    total,
    offset,
    posts: posts.map(({ oc, ...post }, i) => ({
      ...post,
      rank: offset + i + 1,
      author: oc.pseudonym,
      // How long it took to reach 20% of the groups.
      listedAfterMs: post.listedAt!.getTime() - post.createdAt.getTime(),
    })),
  };
}

// GET /api/common — for every registered member: redacted versions only
router.get('/', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await listed(req, false));
}));

// GET /api/common/officer — for a signed-in officer (ProMic session token): both versions
router.get('/officer', handle(async (req: Request, res: Response): Promise<void> => {
  const header = req.headers.authorization ?? '';
  const officer = await officerFor(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!officer) {
    res.status(401).json({ error: 'Sign in again.' });
    return;
  }
  res.json(await listed(req, true));
}));

export default router;
