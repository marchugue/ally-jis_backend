import { Router } from 'express';
import * as interactionController from '../app/controller/moderation.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

// POST /api/moderation/block
router.post('/block', interactionController.blockUser);

// POST /api/moderation/report
router.post('/report', interactionController.reportUser);

// GET /api/moderation/blocked/:userId
router.get('/blocked/:userId', interactionController.checkBlocked);

// DELETE /api/moderation/block/:userId
router.delete('/block/:userId', interactionController.unblockUser);

// GET /api/moderation/blocked
router.get('/blocked', interactionController.listBlocked);

export default router;
