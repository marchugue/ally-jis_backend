// src/routes/auth.routes.ts
//
// ROUTE LAYER
// -----------
// Declares the URL + HTTP method, attaches middleware, calls the
// controller. No logic lives here.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import * as authController from '../app/controller/auth.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Rate Limiters ───────────────────────────────────────────────────────────

/** 5 login attempts per 15 minutes per IP */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many login attempts. Please wait 15 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 3 OTP send/resend attempts per 10 minutes per IP */
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { message: 'Too many OTP requests. Please wait 10 minutes before requesting another code.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 10 OTP verify attempts per 10 minutes per IP */
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: 'Too many verification attempts. Please wait 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 3 registration attempts per hour per IP */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { message: 'Too many registration attempts from this IP. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 10 registration cancels per hour per IP — prevents brute-force account enumeration */
const cancelRegistrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { message: 'Too many cancel requests from this IP. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Auth Routes ─────────────────────────────────────────────────────────────

// POST /api/auth/register
router.post('/register', registerLimiter, authController.register);

// POST /api/auth/login
router.post('/login', loginLimiter, authController.login);

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

// DELETE /api/auth/delete-account — logged in only
router.delete('/delete-account', authMiddleware, authController.deleteAccount);

// GET /api/auth/email/:id
router.get('/email/:id', authController.getEmailVerificationStatus);

// POST /api/auth/confirm — legacy magic-link confirm (deprecated, kept for compatibility)
router.post('/confirm', authController.confirmEmail);

// ─── OTP Routes ──────────────────────────────────────────────────────────────

// POST /api/auth/otp/send — generate and send a new OTP
router.post('/otp/send', otpSendLimiter, authController.sendOtp);

// POST /api/auth/otp/verify — submit the 6-digit code
router.post('/otp/verify', otpVerifyLimiter, authController.verifyOtp);

// POST /api/auth/otp/resend — resend OTP (same rate limit as send)
router.post('/otp/resend', otpSendLimiter, authController.resendOtp);

// GET /api/auth/otp/status/:userId — get OTP status (no code exposed)
router.get('/otp/status/:userId', authController.getOtpStatus);

// ─── Student ID Upload ────────────────────────────────────────────────────────

// POST /api/auth/student-id/upload — upload student ID image for non-CHMSU emails
router.post(
  '/student-id/upload',
  upload.single('file'),
  authController.uploadStudentId
);

// ─── Registration Rollback ────────────────────────────────────────────────────

// DELETE /api/auth/register/cancel — rollback a pending (unverified) registration.
// No auth token required — the user has no session yet. Server-side guard refuses
// the request if the OTP was already verified (i.e., the account is real/active).
router.delete('/register/cancel', cancelRegistrationLimiter, authController.cancelRegistration);

export default router;