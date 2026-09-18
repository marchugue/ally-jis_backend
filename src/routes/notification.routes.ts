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
import type { Request, Response, NextFunction } from 'express';
import * as notificationController from '../app/controller/notification.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

import { checkAndSendStreakReminders, expireUnactivatedStreaks } from '../app/services/streakReminder.service';

const router = Router();

// ── Internal control-panel bypass ───────────────────────────────────────────
// Requests from the local Electron control panel carry X-Control-Panel-Key.
// We validate the shared secret and short-circuit before the auth middleware.
const INTERNAL_KEY = process.env.CONTROL_PANEL_KEY || 'ally-jis-internal-2025';

function internalKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-control-panel-key'];
  if (key === INTERNAL_KEY) {
    next(); // Bypass user-auth for internal calls
    return;
  }
  next('router'); // Fall through to auth-guarded routes below
}

// POST /api/notifications/test-streak-reminders
// Accessible by control panel (internal key) OR authenticated users
router.post('/test-streak-reminders', internalKeyMiddleware, async (_req, res) => {
  const result = await checkAndSendStreakReminders();
  res.status(200).json(result);
});

// POST /api/notifications/test-streak-reminders — auth-guarded fallback
router.post('/test-streak-reminders', authMiddleware, async (_req, res) => {
  const result = await checkAndSendStreakReminders();
  res.status(200).json(result);
});

// POST /api/notifications/test-streak-expiration
router.post('/test-streak-expiration', internalKeyMiddleware, async (_req, res) => {
  const result = await expireUnactivatedStreaks();
  res.status(200).json(result);
});

// POST /api/notifications/test-streak-expiration — auth-guarded fallback
router.post('/test-streak-expiration', authMiddleware, async (_req, res) => {
  const result = await expireUnactivatedStreaks();
  res.status(200).json(result);
});

router.use(authMiddleware);

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
