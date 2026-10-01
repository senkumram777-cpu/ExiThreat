import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { startPushObserver } from './services/pushObserver';
import authRouter from './routes/auth';
import postsRouter from './routes/posts';
import groupsRouter from './routes/groups';
import pushRouter from './routes/push';
import weightageRouter from './routes/weightage';

export const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT ?? 4000;

// ── Security headers ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
}));

// ── Body parsing + compression ─────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(compression());

// ── Global rate limiting ───────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/posts', postsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/push', pushRouter);
app.use('/api/weightage', weightageRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Start ──────────────────────────────────────────────────────────────────
async function main() {
  await prisma.$connect();
  startPushObserver();
  app.listen(PORT, () => {
    console.log(`ExiThreat backend running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
