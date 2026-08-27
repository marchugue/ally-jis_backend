// src/routes/presence.routes.ts
//
// ROUTE LAYER
// -----------
// Declares the URL + HTTP method, attaches middleware, calls the
// controller. No logic lives here.
//
// NOTE: requires the user_presence table, which is NOT in the original
// schema.sql. Run supabase/migrations/001_user_presence.sql (created
// alongside this route) in the Supabase SQL editor before using these
// endpoints.

import { Router } from 'express';
import * as presenceController from '../app/controller/presence.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

// POST /api/presence/heartbeat
router.post('/heartbeat', presenceController.heartbeat);

// GET /api/presence/online
router.get('/online', presenceController.online);

export default router;
