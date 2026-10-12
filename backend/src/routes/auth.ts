import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { prisma } from '../index';
import { signToken, requireAuth, AuthRequest } from '../middleware/auth';
import { handle } from '../middleware/handle';
import { ensureGroup } from '../services/groupService';
import { LIMITS, USERNAME_PATTERN, passwordProblem } from '../services/validation';

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

// Wrong passwords are counted per address and account name, so guessing at one account is
// slow, while somebody else's guesses cannot lock its owner out from another address.
// A second, looser count per address slows guessing across many accounts.
const WRONG_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const WRONG_PASSWORDS_ALLOWED = Number(process.env.LOGIN_ATTEMPTS) || 10;
const tooManyAttempts = { error: 'Too many wrong passwords. Try again in 15 minutes.' };
const loginLimit = rateLimit({
  windowMs: WRONG_PASSWORD_WINDOW_MS,
  max: WRONG_PASSWORDS_ALLOWED,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.username ?? '').toLowerCase().slice(0, 64)}`,
  message: tooManyAttempts,
});
const loginAddressLimit = rateLimit({
  windowMs: WRONG_PASSWORD_WINDOW_MS,
  max: WRONG_PASSWORDS_ALLOWED * 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: tooManyAttempts,
});

// Compared against when the account does not exist, so that answer takes as long as a
// wrong password does and does not reveal which names are taken.
const NO_SUCH_USER_HASH = bcrypt.hashSync('no such user', 12);

// POST /api/auth/register
router.post('/register', registerLimit, handle(async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as { username?: unknown; password?: unknown };
  if (
    typeof username !== 'string'
    || username.length < LIMITS.usernameMin
    || username.length > LIMITS.usernameMax
    || !USERNAME_PATTERN.test(username)
  ) {
    res.status(400).json({
      error: `username must be ${LIMITS.usernameMin} to ${LIMITS.usernameMax} letters, digits, dots, dashes or underscores`,
    });
    return;
  }
  const problem = passwordProblem(password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  // "Asha" and "asha" would be too easy to mistake for each other.
  const existing = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }
  const passwordHash = await bcrypt.hash(password as string, 12);
  const user = await prisma.user.create({ data: { username, passwordHash } });
  await ensureGroup(user.id);
  const token = signToken(user.id, user.username);
  res.status(201).json({ token, userId: user.id, username: user.username });
}));

// POST /api/auth/login
router.post('/login', loginAddressLimit, loginLimit, handle(async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { username } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? NO_SUCH_USER_HASH);
  if (!user || !valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  // Accounts from before groups were assigned get theirs here.
  await ensureGroup(user.id);
  const token = signToken(user.id, user.username);
  res.json({ token, userId: user.id, username: user.username });
}));

// POST /api/auth/password — change the password. Signs every other device out.
router.post('/password', requireAuth, loginLimit, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { currentPassword, newPassword } = req.body as { currentPassword?: unknown; newPassword?: unknown };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  // 400, not 401: the caller is signed in, it is the old password that is wrong.
  if (!user || typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(400).json({ error: 'Current password is wrong' });
    return;
  }
  const problem = passwordProblem(newPassword);
  if (problem) {
    res.status(400).json({ error: `new ${problem}` });
    return;
  }
  const passwordHash = await bcrypt.hash(newPassword as string, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash, tokensValidFrom: new Date() } });
  res.json({ token: signToken(user.id, user.username), userId: user.id, username: user.username });
}));

// POST /api/auth/signout-all — every token issued so far stops working, this one included
router.post('/signout-all', requireAuth, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  // Token times are whole seconds; the next second, so that a token issued in this one is out too.
  const from = new Date((Math.floor(Date.now() / 1000) + 1) * 1000);
  await prisma.user.update({ where: { id: req.userId! }, data: { tokensValidFrom: from } });
  res.json({ ok: true });
}));

export default router;
