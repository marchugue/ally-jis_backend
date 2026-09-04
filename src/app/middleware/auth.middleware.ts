import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import * as authModel from '../models/auth.model';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Routes that an unapproved external-email student IS allowed to call
 * even while their identity is pending admin review.
 *
 * Everything else returns 403 PENDING_APPROVAL so the frontend can
 * hard-redirect them to /pending-approval.
 */
const APPROVAL_EXEMPT_PATHS = new Set([
  '/api/auth/session',   // needed to poll approval status
  '/api/auth/logout',    // must always be callable
]);

export const authMiddleware = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ message: 'Missing access token' });
    return;
  }

  try {
    const user = await authModel.getUserFromToken(token);
    if (!user) {
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }

    // ── Moderation + identity checks (single DB round-trip) ───────────
    const flags = await authModel.getModerationFlags(user.id);

    if (flags?.is_banned) {
      res.status(403).json({ message: 'This account has been banned.' });
      return;
    }
    if (flags?.is_suspended && (!flags.suspended_until || new Date(flags.suspended_until) > new Date())) {
      res.status(403).json({ message: 'This account is suspended.' });
      return;
    }
    if (flags?.session_invalidated_at) {
      const decoded = jwt.decode(token) as { iat?: number } | null;
      const tokenIssuedAt = decoded?.iat ? decoded.iat * 1000 : 0;
      if (tokenIssuedAt < new Date(flags.session_invalidated_at).getTime()) {
        res.status(401).json({ message: 'Session has been signed out remotely. Please log in again.' });
        return;
      }
    }

    // ── Approval gate — external-email students only ───────────────────
    // A student using a personal/external email must have their identity
    // verified by an admin before they can access any protected resource.
    // CHMSU-email students are auto-verified; admins are never blocked here.
    //
    // We check the raw DB flags rather than the JWT claims to prevent
    // any client-side tampering: even if a student manually crafts a JWT
    // with admin_verified=true in the payload, the DB is the source of truth.
    const isExternalEmail = flags?.email_type === 'external';
    const isApproved =
      flags?.chmsu_auto_verified ||
      flags?.admin_verified ||
      flags?.student_verification_status === 'approved';

    if (isExternalEmail && !isApproved) {
      // Whitelist a small set of auth endpoints so the student can still
      // poll for approval status and sign out cleanly.
      const path = req.path; // relative to the router mount point
      const fullPath = req.originalUrl.split('?')[0]; // absolute, no query string
      const isExempt =
        APPROVAL_EXEMPT_PATHS.has(fullPath) ||
        path === '/session' ||
        path === '/logout';

      if (!isExempt) {
        res.status(403).json({
          code: 'PENDING_APPROVAL',
          message: 'Your student identity is pending admin verification. Access is restricted until approved.',
        });
        return;
      }
    }

    req.userId = user.id;
    req.accessToken = token;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
});

export const optionalAuthMiddleware = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (token) {
    try {
      const user = await authModel.getUserFromToken(token);
      if (user) {
        req.userId = user.id;
        req.accessToken = token;
      }
    } catch {}
  }
  next();
});