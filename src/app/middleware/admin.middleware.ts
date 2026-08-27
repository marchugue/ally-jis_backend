// src/app/middleware/admin.middleware.ts
//
// Layer after authMiddleware on every /admin/* route — req.userId must
// already be set. requireAdminRole alone is enough for read-mostly
// endpoints; requirePermission(x) is the finer-grained gate for anything
// that changes state.

import type { NextFunction, Request, Response } from 'express';
import * as adminModel from '../models/admin.model';
import * as adminService from '../services/admin.service';
import { asyncHandler } from '../utils/asyncHandler';
import { isAdminRole } from '../constants/permissions';
import type { Permission } from '../types/admin.types';

export const requireAdminRole = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const role = await adminModel.getUserRole(req.userId as string);
  if (!role || !isAdminRole(role)) {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }
  req.adminRole = role;
  next();
});

export function requirePermission(permission: Permission) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const allowed = await adminService.hasPermission(req.userId as string, permission);
    if (!allowed) {
      res.status(403).json({ message: `Missing permission: ${permission}` });
      return;
    }
    next();
  });
}
