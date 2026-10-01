import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
}

const JWT_SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';

export function signToken(userId: string, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
