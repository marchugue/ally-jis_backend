// src/app/controller/adminSearch.controller.ts

import type { Request, Response } from 'express';
import * as adminSearchService from '../services/adminSearch.service';
import { asyncHandler } from '../utils/asyncHandler';

// GET /admin/search?q=
export const search = asyncHandler(async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const result = await adminSearchService.search(q);
  res.status(200).json(result);
});
