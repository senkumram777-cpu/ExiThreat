import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../index';
import { signToken } from '../middleware/auth';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
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
  const token = signToken(user.id, user.username);
  res.json({ token, userId: user.id, username: user.username });
});

export default router;
