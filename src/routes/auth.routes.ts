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

// POST /api/auth/change-password — logged in only
router.post('/change-password', authMiddleware, authController.changePassword);

// GET /api/auth/email/:id
router.get('/email/:id', authController.getEmailVerificationStatus);

// POST /api/auth/confirm
// Called by the frontend ConfirmPage with the token_hash from the
// Supabase confirmation-email link (?token_hash=xxx&type=signup).
router.post('/confirm', authController.confirmEmail);

export default router;