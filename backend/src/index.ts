import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { startPushSweep } from './services/pushSweep';
import authRouter from './routes/auth';
import postsRouter from './routes/posts';
import groupsRouter from './routes/groups';
import pushRouter from './routes/push';
import weightageRouter from './routes/weightage';
import promicRouter from './routes/promic';
import commonRouter from './routes/common';
import adminRouter from './routes/admin';
import { loadRules, rule } from './services/settings';

export const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT ?? 4000;

// Behind a hosting proxy (Fly.io) the caller's address arrives in X-Forwarded-For; without
// this every visitor would share one rate-limit bucket. Unset locally.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

// ── Security headers ───────────────────────────────────────────────────────
app.use(helmet());
// FRONTEND_ORIGIN may list several addresses, comma-separated (the site and its admin subdomain).
app.use(cors({
  origin: (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim()),
  credentials: true,
}));

// ── Body parsing + compression ─────────────────────────────────────────────
// The largest thing a user sends is a 5,000-character post.
app.use(express.json({ limit: '100kb' }));
app.use(compression());

// ── Global rate limiting ───────────────────────────────────────────────────
// Room for normal use: one open group page polls its chat 180 times in 15 minutes, a post
// page its votes 60 times, and several people may share one office address. Sign-up and
// sign-in have their own, much lower limits (routes/auth.ts).
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
}));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/posts', postsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/push', pushRouter);
app.use('/api/weightage', weightageRouter);
app.use('/api/promic', promicRouter);
app.use('/api/common', commonRouter);
app.use('/api/admin', adminRouter);

// The rules the website mentions in its text, as an admin has set them (services/rules.ts).
app.get('/api/rules', (_req, res) => {
  res.json({
    pushThreshold: rule('pushThreshold'),
    listShare: rule('listShare'),
    maxGroupsAtOnce: rule('maxGroupsAtOnce'),
    manualPushCooldownHours: rule('manualPushCooldownHours'),
    registrationOpen: rule('registrationOpen') === 1,
  });
});

// Also asks the database, so a server that is up but cannot reach it is reported as down.
app.get('/api/health', (_req, res) => {
  prisma.$queryRaw`SELECT 1`
    .then(() => res.json({ status: 'ok' }))
    .catch((err) => {
      console.error('Health check: database not reachable:', err);
      res.status(503).json({ status: 'database unavailable' });
    });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Errors ─────────────────────────────────────────────────────────────────
// Everything a route throws ends up here (see middleware/handle.ts). The details go to the
// log; the caller gets a plain message, always as JSON.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Request too large' });
    return;
  }
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed request' });
    return;
  }
  console.error('Request failed:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// A failure outside a request (the push sweep catches its own) is logged, not fatal.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// ── Start ──────────────────────────────────────────────────────────────────
async function main() {
  await prisma.$connect();
  await loadRules();
  startPushSweep();
  app.listen(PORT, () => {
    console.log(`ExiThreat backend running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
