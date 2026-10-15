import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { signToken, requireSignedIn, AuthRequest, SUSPENDED, SUSPENDED_MESSAGE } from '../middleware/auth';
import { rule } from '../services/settings';
import { handle } from '../middleware/handle';
import { ensureGroup } from '../services/groupService';
import { randomPseudonym } from '../services/pseudonym';
import { addTimeToday, noteActiveDay } from '../services/groupWeightService';
import { recalculateMemberWeight } from '../services/memberWeightService';
import { LIMITS, USERNAME_PATTERN, passwordProblem } from '../services/validation';
import {
  Channel,
  ContactError,
  assertUnused,
  checkCode,
  consumeProofs,
  fingerprintOf,
  proofOf,
  startEmailVerification,
} from '../services/contactService';
import { phoneProofFromToken } from '../services/phoneVerification';

const router = Router();

// Each account needs its own email address and mobile number (see contactService.ts), which
// is what keeps one person to one account. This looser count per network address is a second
// line against mass sign-ups. Requests that fail (name taken, bad input) are not counted.
const registerLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: Number(process.env.REGISTER_LIMIT_PER_DAY) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  message: { error: 'Too many accounts created from this network today. Try again tomorrow.' },
});

// Every code lands in someone's inbox or costs an SMS, so one network address can ask for only
// so many. Per email address the limits are in contactService.ts; Firebase limits SMS itself.
const codeLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.CODE_SENDS_PER_HOUR) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  message: { error: 'Too many codes asked for from this network. Try again in an hour.' },
});
const codeCheckLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many wrong codes. Try again in 15 minutes.' },
});

// Wrong passwords are counted per address and account name, so guessing at one account is
// slow, while somebody else's guesses cannot lock its owner out from another address.
// A second, looser count per address slows guessing across many accounts.
const WRONG_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const WRONG_PASSWORDS_ALLOWED = Number(process.env.LOGIN_ATTEMPTS) || 10;
const tooManyAttempts = { error: 'Too many wrong passwords. Try again in 15 minutes.' };
const loginName = (req: Request) => String(req.body?.identifier ?? req.body?.username ?? '');
const loginLimit = rateLimit({
  windowMs: WRONG_PASSWORD_WINDOW_MS,
  max: WRONG_PASSWORDS_ALLOWED,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${loginName(req).toLowerCase().slice(0, 64)}`,
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

function isChannel(value: unknown): value is Channel {
  return value === 'email' || value === 'phone';
}

/** Answers a ContactError with its status; anything else goes to the error handler. */
async function contactStep(res: Response, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (err) {
    if (err instanceof ContactError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // Two requests with the same address at once: the database's unique index stops the second.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'This email address or mobile number is already used by another account.' });
      return;
    }
    throw err;
  }
}

/** The answer to a sign-up or sign-in. Signing in is a day of use for the group's weight. */
function session(user: { id: string; username: string; emailHash: string | null; phoneHash: string | null }) {
  void noteActiveDay(user.id);
  return {
    token: signToken(user.id, user.username),
    userId: user.id,
    username: user.username,
    // An older account must add its email and mobile number before it can use the site.
    needsContact: !user.emailHash || !user.phoneHash,
  };
}

// POST /api/auth/verify/start — send a code to an email address
router.post('/verify/start', codeLimit, handle(async (req: Request, res: Response): Promise<void> => {
  const { channel, value } = req.body as { channel?: unknown; value?: unknown };
  if (channel !== 'email') {
    res.status(400).json({ error: 'Codes are sent here to email addresses only; mobile numbers use /auth/verify/phone' });
    return;
  }
  await contactStep(res, async () => {
    const { verificationId } = await startEmailVerification(value);
    res.json({ verificationId, expiresInSeconds: 600, resendInSeconds: Number(process.env.CODE_RESEND_SECONDS) || 60 });
  });
}));

// POST /api/auth/verify/phone — a mobile number confirmed by Firebase in the browser
router.post('/verify/phone', codeLimit, handle(async (req: Request, res: Response): Promise<void> => {
  const { idToken } = req.body as { idToken?: unknown };
  await contactStep(res, async () => {
    res.json({ verificationId: await phoneProofFromToken(idToken) });
  });
}));

// POST /api/auth/verify/check — enter the code that was sent
router.post('/verify/check', codeCheckLimit, handle(async (req: Request, res: Response): Promise<void> => {
  const { verificationId, code } = req.body as { verificationId?: unknown; code?: unknown };
  await contactStep(res, async () => {
    await checkCode(verificationId, code);
    res.json({ verified: true });
  });
}));

// POST /api/auth/register — needs a confirmed email address and mobile number
router.post('/register', registerLimit, handle(async (req: Request, res: Response): Promise<void> => {
  // An admin can pause sign-ups (services/rules.ts).
  if (rule('registrationOpen') !== 1) {
    res.status(403).json({ error: 'New accounts cannot be created at the moment. Try again later.' });
    return;
  }
  const { username, password, emailVerificationId, phoneVerificationId } = req.body as {
    username?: unknown; password?: unknown; emailVerificationId?: string; phoneVerificationId?: string;
  };
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
  // A name of digits only could be mistaken for a mobile number at sign-in.
  if (/^[\d.\-_]+$/.test(username)) {
    res.status(400).json({ error: 'username must contain at least one letter' });
    return;
  }
  const problem = passwordProblem(password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  await contactStep(res, async () => {
    const emailHash = await proofOf('email', emailVerificationId);
    const phoneHash = await proofOf('phone', phoneVerificationId);
    // Only someone who has just proved they own the address or number can learn that it is in use.
    await assertUnused('email', emailHash);
    await assertUnused('phone', phoneHash);

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
    const user = await createWithPseudonym({ username, passwordHash, emailHash, phoneHash });
    await consumeProofs(emailVerificationId, phoneVerificationId);
    await ensureGroup(user.id);
    res.status(201).json(session(user));
  });
}));

/** Creates the account with a random pseudonym, drawing again in the rare case it is taken. */
async function createWithPseudonym(data: { username: string; passwordHash: string; emailHash: string; phoneHash: string }) {
  for (let attempt = 0; ; attempt++) {
    const pseudonym = randomPseudonym();
    if (attempt < 5 && (await prisma.user.findUnique({ where: { pseudonym }, select: { id: true } }))) continue;
    return prisma.user.create({ data: { ...data, pseudonym } });
  }
}

// POST /api/auth/login — with the username, email address or mobile number
router.post('/login', loginAddressLimit, loginLimit, handle(async (req: Request, res: Response): Promise<void> => {
  const identifier = loginName(req).trim();
  const { password } = req.body as { password?: unknown };
  if (!identifier || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Username, email or mobile number, and password required' });
    return;
  }

  let user = null;
  if (identifier.includes('@')) {
    const hash = fingerprintOf('email', identifier);
    if (hash) user = await prisma.user.findUnique({ where: { emailHash: hash } });
  } else {
    const hash = fingerprintOf('phone', identifier);
    if (hash) user = await prisma.user.findUnique({ where: { phoneHash: hash } });
    // Older usernames may be digits only.
    if (!user) user = await prisma.user.findUnique({ where: { username: identifier } });
  }

  const valid = await bcrypt.compare(password, user?.passwordHash ?? NO_SUCH_USER_HASH);
  if (!user || !valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  if (user.suspendedAt) {
    res.status(403).json({ error: SUSPENDED_MESSAGE, code: SUSPENDED });
    return;
  }
  // Accounts from before groups were assigned get theirs here.
  await ensureGroup(user.id);
  res.json(session(user));
}));

// GET /api/auth/me — the signed-in account, and whether its contact details are complete
router.get('/me', requireSignedIn, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.userId! },
    select: { id: true, username: true, pseudonym: true, emailHash: true, phoneHash: true },
  });
  res.json({
    userId: user.id,
    username: user.username,
    // Shown with their posts in place of the username; only they see the two together.
    pseudonym: user.pseudonym,
    hasEmail: !!user.emailHash,
    hasPhone: !!user.phoneHash,
  });
}));

// POST /api/auth/heartbeat — the website, while it is open and in view, reports the time since
// its last report (it sends one a minute; more than two minutes at once is not believed).
router.post('/heartbeat', requireSignedIn, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const raw = Number((req.body as { seconds?: unknown } | undefined)?.seconds);
  const seconds = Math.min(120, Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0)));
  if (seconds > 0) await addTimeToday(req.userId!, seconds);
  res.json({ ok: true });
}));

// GET /api/auth/weight — the signed-in member's own weightage, worked out now. Only for them.
router.get('/weight', requireSignedIn, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await recalculateMemberWeight(req.userId!));
}));

// POST /api/auth/contact — an older account adds the email address and mobile number it lacks.
// Contact details cannot be changed once set: a freed address could open a second account.
router.post('/contact', requireSignedIn, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  const { emailVerificationId, phoneVerificationId } = req.body as {
    emailVerificationId?: string; phoneVerificationId?: string;
  };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
  if (user.emailHash && user.phoneHash) {
    res.status(409).json({ error: 'This account already has its email address and mobile number' });
    return;
  }
  await contactStep(res, async () => {
    const data: { emailHash?: string; phoneHash?: string } = {};
    if (!user.emailHash) data.emailHash = await proofOf('email', emailVerificationId);
    if (!user.phoneHash) data.phoneHash = await proofOf('phone', phoneVerificationId);
    if (data.emailHash) await assertUnused('email', data.emailHash, user.id);
    if (data.phoneHash) await assertUnused('phone', data.phoneHash, user.id);
    const updated = await prisma.user.update({ where: { id: user.id }, data });
    await consumeProofs(emailVerificationId, phoneVerificationId);
    res.json(session(updated));
  });
}));

// POST /api/auth/reset — a new password, with a code sent to the account's email or mobile.
// Signs every device out.
router.post('/reset', loginAddressLimit, handle(async (req: Request, res: Response): Promise<void> => {
  const { channel, verificationId, newPassword } = req.body as {
    channel?: unknown; verificationId?: string; newPassword?: unknown;
  };
  if (!isChannel(channel)) {
    res.status(400).json({ error: 'channel must be "email" or "phone"' });
    return;
  }
  const problem = passwordProblem(newPassword);
  if (problem) {
    res.status(400).json({ error: `new ${problem}` });
    return;
  }
  await contactStep(res, async () => {
    const hash = await proofOf(channel, verificationId);
    const user = await prisma.user.findFirst({
      where: channel === 'email' ? { emailHash: hash } : { phoneHash: hash },
    });
    if (!user) {
      res.status(404).json({
        error: `No account uses this ${channel === 'email' ? 'email address' : 'mobile number'}.`,
      });
      return;
    }
    const passwordHash = await bcrypt.hash(newPassword as string, 12);
    // Token times are whole seconds: from the next one, so that older tokens of this second end too.
    const from = new Date((Math.floor(Date.now() / 1000) + 1) * 1000);
    const updated = await prisma.user.update({ where: { id: user.id }, data: { passwordHash, tokensValidFrom: from } });
    await consumeProofs(verificationId);
    // The new token is issued in the next second, so that it is not cut off with the old ones.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, from.getTime() - Date.now())));
    res.json(session(updated));
  });
}));

// POST /api/auth/password — change the password. Signs every other device out.
router.post('/password', requireSignedIn, loginLimit, handle(async (req: AuthRequest, res: Response): Promise<void> => {
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
  res.json(session(user));
}));

// POST /api/auth/signout-all — every token issued so far stops working, this one included
router.post('/signout-all', requireSignedIn, handle(async (req: AuthRequest, res: Response): Promise<void> => {
  // Token times are whole seconds; the next second, so that a token issued in this one is out too.
  const from = new Date((Math.floor(Date.now() / 1000) + 1) * 1000);
  await prisma.user.update({ where: { id: req.userId! }, data: { tokensValidFrom: from } });
  res.json({ ok: true });
}));

export default router;
