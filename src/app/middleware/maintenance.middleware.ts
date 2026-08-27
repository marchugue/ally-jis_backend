// src/app/middleware/maintenance.middleware.ts
//
// Mounted first inside routes/index.ts, ahead of every other route, so
// req.path here is relative to the /api mount (e.g. '/admin/dashboard/kpis',
// '/auth/login'). Always lets /health, everything under /admin, and
// /auth/login through — otherwise an admin couldn't log in to turn
// maintenance mode back off, and health checks would falsely report down.

import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { isMaintenanceModeOn } from '../services/adminSettings.service';

const ALWAYS_ALLOWED_PREFIXES = ['/health', '/admin'];
const ALWAYS_ALLOWED_EXACT = ['/auth/login'];

export const maintenanceMiddleware = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (ALWAYS_ALLOWED_PREFIXES.some((p) => req.path.startsWith(p)) || ALWAYS_ALLOWED_EXACT.includes(req.path)) {
    next();
    return;
  }

  const { on, message } = await isMaintenanceModeOn();
  if (on) {
    res.status(503).json({ message, maintenance: true });
    return;
  }

  next();
});
