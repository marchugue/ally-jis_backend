// src/routes/auth.routes.ts
//
// ROUTE LAYER
// -----------
// Declares the URL + HTTP method, attaches middleware, calls the
// controller. No logic lives here.

import { Router } from 'express';
import * as authController from '../app/controller/auth.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

// POST /api/auth/register
router.post('/register', authController.register);

// POST /api/auth/login
router.post('/login', authController.login);

// POST /api/auth/logout
router.post('/logout', authMiddleware, authController.logout);

// GET /api/auth/session
router.get('/session', authMiddleware, authController.session);

// POST /api/auth/forgot-password
router.post('/forgot-password', authController.forgotPassword);

// POST /api/auth/reset-password
router.post('/reset-password', authController.resetPassword);

export default router;