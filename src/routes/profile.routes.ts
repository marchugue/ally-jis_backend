// src/routes/profile.routes.ts
//
// ROUTE LAYER
// -----------
// Declares the URL + HTTP method, attaches middleware, calls the
// controller. No logic lives here.
//
// IMPORTANT: static paths (/me, /batch, /check-username) must be
// registered BEFORE the dynamic /:userId route, or Express will treat
// "me", "batch", "check-username" as a userId value.

import { Router } from 'express';
import * as profileController from '../app/controller/profile.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

// GET /api/profiles/me
router.get('/me', authMiddleware, profileController.getMe);

// PATCH /api/profiles/me
router.patch('/me', authMiddleware, profileController.updateMe);

// DELETE /api/profiles/me
router.delete('/me', authMiddleware, profileController.deleteMe);

// POST /api/profiles/batch
router.post('/batch', authMiddleware, profileController.batch);

// GET /api/profiles/check-username?username=x&excludeId=y
// Auth is optional per the spec — no authMiddleware here.
router.get('/check-username', profileController.checkUsername);

// GET /api/profiles?exclude={userId}
router.get('/', authMiddleware, profileController.list);

// GET /api/profiles/:userId — must come after the static routes above
router.get('/:userId', authMiddleware, profileController.getById);

export default router;