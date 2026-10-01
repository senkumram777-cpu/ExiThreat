import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../index';
import { requireAuth, AuthRequest } from '../middleware/auth';
import {
  ProMicError,
  redeemLinkCode,
  getHostName,
  listBackups,
  getAudioBackup,
  getVideoBackup,
} from '../services/promicService';

const router = Router();

// Firebase push ids / UUIDs only — the id is interpolated into a database path.
const SEGMENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

// Link codes are short enough to be worth guessing at — keep attempts scarce.
const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function fail(res: Response, err: unknown): void {
  if (err instanceof ProMicError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('ProMic request failed:', err);
  res.status(502).json({ error: 'Could not reach ProMic' });
}

async function linkedHostId(userId: string): Promise<string | null> {
  const link = await prisma.proMicLink.findUnique({ where: { userId } });
  return link?.hostId ?? null;
}

// GET /api/promic/link — is this account linked to a ProMic host?
router.get('/link', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const link = await prisma.proMicLink.findUnique({ where: { userId: req.userId! } });
  if (!link) {
    res.json({ linked: false });
    return;
  }
  let hostName: string | null = null;
  try {
    hostName = await getHostName(link.hostId);
  } catch {
    // Name is cosmetic — the link itself is still valid if ProMic is unreachable.
  }
  res.json({ linked: true, hostName, linkedAt: link.linkedAt });
});

// POST /api/promic/link — redeem a one-time code generated in the ProMic app's Settings
router.post('/link', linkLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'code required' });
    return;
  }
  try {
    const hostId = await redeemLinkCode(code);
    const link = await prisma.proMicLink.upsert({
      where: { userId: req.userId! },
      update: { hostId, linkedAt: new Date() },
      create: { userId: req.userId!, hostId },
    });
    const hostName = await getHostName(hostId).catch(() => null);
    res.status(201).json({ linked: true, hostName, linkedAt: link.linkedAt });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/promic/link — unlink
router.delete('/link', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.proMicLink.deleteMany({ where: { userId: req.userId! } });
  res.json({ linked: false });
});

// GET /api/promic/backups — metadata for the linked host's audio + video backups
router.get('/backups', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const hostId = await linkedHostId(req.userId!);
  if (!hostId) {
    res.status(404).json({ error: 'No ProMic account linked' });
    return;
  }
  try {
    res.json(await listBackups(hostId));
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/promic/backups/audio/:id — decrypted backup audio as WAV
// GET /api/promic/backups/video/:id — decrypted emergency clip as MP4
router.get('/backups/:kind(audio|video)/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { kind, id } = req.params;
  if (!SEGMENT_ID.test(id)) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }
  const hostId = await linkedHostId(req.userId!);
  if (!hostId) {
    res.status(404).json({ error: 'No ProMic account linked' });
    return;
  }
  try {
    const data = kind === 'audio' ? await getAudioBackup(hostId, id) : await getVideoBackup(hostId, id);
    res.setHeader('Content-Type', kind === 'audio' ? 'audio/wav' : 'video/mp4');
    res.setHeader('Content-Length', data.length);
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  } catch (err) {
    fail(res, err);
  }
});

export default router;
