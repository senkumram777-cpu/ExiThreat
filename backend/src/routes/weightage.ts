import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getPostWeightage, recalculateTotalWeight } from '../services/weightageService';

const router = Router();

// GET /api/weightage/:postId — fetch aggregated weightage + full history
router.get('/:postId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { postId } = req.params;
  const result = await getPostWeightage(postId);
  if (!result) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  res.json(result);
});

// POST /api/weightage/:postId/recalculate — force recalculation (admin utility)
router.post('/:postId/recalculate', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { postId } = req.params;
  try {
    const total = await recalculateTotalWeight(postId);
    res.json({ postId, totalWeight: total });
  } catch {
    res.status(404).json({ error: 'Post not found' });
  }
});

export default router;
