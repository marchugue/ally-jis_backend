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

// Restrict routes
// POST /api/moderation/restrict
router.post('/restrict', interactionController.restrictUser);

// DELETE /api/moderation/restrict/:userId
router.delete('/restrict/:userId', interactionController.unrestrictUser);

// GET /api/moderation/restricted/:userId
router.get('/restricted/:userId', interactionController.checkRestricted);

// GET /api/moderation/restricted
router.get('/restricted', interactionController.listRestricted);

// Mute routes
// POST /api/moderation/mute
router.post('/mute', interactionController.muteUser);

// DELETE /api/moderation/mute/:userId
router.delete('/mute/:userId', interactionController.unmuteUser);

// GET /api/moderation/muted/:userId
router.get('/muted/:userId', interactionController.checkMuted);

// GET /api/moderation/muted
router.get('/muted', interactionController.listMuted);

export default router;

