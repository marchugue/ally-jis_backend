// src/routes/follow.routes.ts

import { Router } from 'express';
import * as followController from '../app/controller/follow.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

// Static/prefixed paths before the dynamic /:userId family.
router.get('/status/:userId', followController.getStatus);
router.get('/counts/:userId', followController.getCounts);
router.get('/:userId/followers', followController.listFollowers);
router.get('/:userId/following', followController.listFollowing);

router.post('/:userId', followController.followUser);
router.delete('/:userId', followController.unfollowUser);

export default router;
