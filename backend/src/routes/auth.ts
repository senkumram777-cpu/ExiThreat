import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { prisma } from '../index';
import { signToken } from '../middleware/auth';
import { ensureGroup } from '../services/groupService';

const router = Router();

// Groups are only as trustworthy as their members are separate people, so one address can
// open only a few accounts a day. Requests that fail (name taken, bad input) are not counted.
const registerLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: Number(process.env.REGISTER_LIMIT_PER_DAY) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  message: { error: 'Too many accounts created from this network today. Try again tomorrow.' },
});

// POST /api/auth/register
router.post('/register', registerLimit, async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password || username.length < 3 || password.length < 8) {
    res.status(400).json({ error: 'username >= 3 chars and password >= 8 chars required' });
    return;
  }
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { username, passwordHash } });
  await ensureGroup(user.id);
  const token = signToken(user.id, user.username);
  res.status(201).json({ token, userId: user.id, username: user.username });
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  // Accounts from before groups were assigned get theirs here.
  await ensureGroup(user.id);
  const token = signToken(user.id, user.username);
  res.json({ token, userId: user.id, username: user.username });
});

export default router;
