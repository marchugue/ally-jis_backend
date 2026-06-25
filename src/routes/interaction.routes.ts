// src/routes/interaction.routes.ts
//
// ROUTE LAYER
// -----------
// Declares the URL + HTTP method, attaches middleware, calls the
// controller. No logic lives here.
//
// IMPORTANT: static paths (/incoming, /request, /accept, /reject) must be
// registered before the dynamic /status/:targetUserId route family is
// fine here since it's prefixed with /status, but keep this order if you
// add more dynamic segments later.

import { Router } from 'express';
import * as interactionController from '../app/controller/interaction.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

// GET /api/interactions
router.get('/', interactionController.list);

// POST /api/interactions/incoming
router.post('/incoming', interactionController.incoming);

// POST /api/interactions/request
router.post('/request', interactionController.request);

// POST /api/interactions/accept
router.post('/accept', interactionController.accept);

// POST /api/interactions/reject
router.post('/reject', interactionController.reject);

// GET /api/interactions/status/:targetUserId
router.get('/status/:targetUserId', interactionController.status);

export default router;
