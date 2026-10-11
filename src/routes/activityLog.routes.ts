// src/routes/activityLog.routes.ts

import { Router } from 'express';
import { authMiddleware } from '../app/middleware/auth.middleware';
import * as activityLogController from '../app/controller/activityLog.controller';

const router = Router();

router.use(authMiddleware);

// GET /api/activity-logs?bucket=all&limit=20&cursor=...
router.get('/', activityLogController.listActivities);

// DELETE /api/activity-logs (optional ?bucket=content)
router.delete('/', activityLogController.clearActivities);

// DELETE /api/activity-logs/:id
router.delete('/:id', activityLogController.deleteActivity);

export default router;
