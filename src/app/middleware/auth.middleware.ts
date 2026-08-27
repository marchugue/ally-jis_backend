import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import * as authModel from '../models/auth.model';
import { asyncHandler } from '../utils/asyncHandler';

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

    // Moderation checks — banned/suspended users, and anyone force-logged-out
    // by an admin, are rejected here rather than in individual routes, so
    // there's exactly one place this is enforced. Supabase already verified
    // the token's signature via getUserFromToken above; jwt.decode here just
    // reads the already-trusted iat claim, it doesn't re-verify anything.
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

    req.userId = user.id;
    req.accessToken = token;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
});