import { Router } from 'express';
import { getLookupsHandler } from '../app/controller/lookup.controller';

const router = Router();

// GET /api/lookups — public, no auth required
router.get('/', getLookupsHandler);

export default router;