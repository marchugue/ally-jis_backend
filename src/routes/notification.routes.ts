// src/routes/notification.routes.ts
//
// ROUTE LAYER
// -----------
// Declares the URL + HTTP method, attaches middleware, calls the
// controller. No logic lives here.
//
// IMPORTANT: static paths (/friend-requests, /read-all) must be registered
// before the dynamic /:id/read route, or Express will treat
// "friend-requests" / "read-all" as a notification id.

import { Router } from 'express';
import * as notificationController from '../app/controller/notification.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

import { checkAndSendStreakReminders } from '../app/services/streakReminder.service';

const router = Router();

router.use(authMiddleware);

// POST /api/notifications/test-streak-reminders (trigger manual check)
router.post('/test-streak-reminders', async (_req, res) => {
  const result = await checkAndSendStreakReminders();
  res.status(200).json(result);
});

// GET /api/notifications/friend-requests
router.get('/friend-requests', notificationController.friendRequests);

// PATCH /api/notifications/read-all
router.patch('/read-all', notificationController.markAllRead);

// GET /api/notifications?limit=20
router.get('/', notificationController.list);

// PATCH /api/notifications/:id/read
router.patch('/:id/read', notificationController.markRead);

// DELETE /api/notification/
router.delete('/', notificationController.clearAll);

export default router;
