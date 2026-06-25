import type { Request, Response, NextFunction } from 'express';
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
    req.userId = user.id;
    req.accessToken = token;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
});