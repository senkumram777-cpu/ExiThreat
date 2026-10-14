import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
}

/**
 * The key sign-in tokens are signed with. Anyone who knows it can sign in as anyone, so the
 * server does not start without one, and a hosted server does not start with the example
 * value from .env.example or with a short one.
 */
function readSecret(): string {
  const secret = process.env.JWT_SECRET ?? '';
  const hosted = process.env.NODE_ENV === 'production' || !!process.env.FLY_APP_NAME;
  const weak = secret.length < 32 || secret.includes('change-me');
  if (!secret || (hosted && weak)) {
    throw new Error(
      'JWT_SECRET is missing or unsafe. Set it to a long random value '
      + '(for example the output of: openssl rand -hex 32).',
    );
  }
  if (weak) console.warn('JWT_SECRET is an example or short value. Fine on this computer only.');
  return secret;
}

const JWT_SECRET = readSecret();

export function signToken(userId: string, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });
}

/** Answered, with this `code`, to an account that has no email or mobile number yet. */
export const CONTACT_REQUIRED = 'CONTACT_REQUIRED';

/**
 * A valid sign-in to an account that has its email address and mobile number. Older
 * accounts without them are refused with CONTACT_REQUIRED until they add them.
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  checkToken(req, res, next, true);
}

/** A valid sign-in, with or without contact details: for adding them and managing the account. */
export function requireSignedIn(req: AuthRequest, res: Response, next: NextFunction): void {
  checkToken(req, res, next, false);
}

function checkToken(req: AuthRequest, res: Response, next: NextFunction, needContact: boolean): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }
  let payload: { userId: string; username: string; iat?: number };
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET) as typeof payload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // The account must still exist, and the token must not be older than the last password
  // change or "sign out everywhere" (User.tokensValidFrom). Token times are whole seconds.
  prisma.user
    .findUnique({
      where: { id: payload.userId },
      select: { username: true, tokensValidFrom: true, emailHash: true, phoneHash: true },
    })
    .then((user) => {
      const validFrom = user?.tokensValidFrom ? Math.floor(user.tokensValidFrom.getTime() / 1000) : 0;
      if (!user || (payload.iat ?? 0) < validFrom) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
      if (needContact && (!user.emailHash || !user.phoneHash)) {
        res.status(403).json({ error: 'Add your email address and mobile number to continue.', code: CONTACT_REQUIRED });
        return;
      }
      req.userId = payload.userId;
      req.username = user.username;
      next();
    })
    .catch(next);
}
