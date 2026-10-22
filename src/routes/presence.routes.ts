// src/routes/presence.routes.ts
//
// ROUTE LAYER
// -----------
// Declares the URL + HTTP method, attaches middleware, calls the
// controller. No logic lives here.

import { Router } from 'express';
import * as presenceController from '../app/controller/presence.controller';
import { authMiddleware, optionalAuthMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

// POST /api/presence/webhook
// Real-time webhook on online presence for all platforms (web, game, mobile app, Supabase)
router.post('/webhook', presenceController.webhook);

// GET /api/presence/online
// Available with optional auth so public/guest campus dashboards can also display online counts
router.get('/online', optionalAuthMiddleware, presenceController.online);

// Authenticated endpoints below
router.use(authMiddleware);

// POST /api/presence/heartbeat
router.post('/heartbeat', presenceController.heartbeat);

export default router;
