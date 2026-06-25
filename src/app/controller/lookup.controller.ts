import type { Request, Response } from 'express';
import { getLookups } from '../services/lookup.service';

/**
 * GET /api/lookups
 * Public route — no auth required. Returns organizations, departments,
 * courses, and interests in one payload so the frontend can populate
 * registration / edit-profile dropdowns with a single request.
 */
export async function getLookupsHandler(_req: Request, res: Response): Promise<void> {
  try {
    const lookups = await getLookups();
    res.status(200).json(lookups);
  } catch (error) {
    console.error('GET /lookups error:', error);
    res.status(500).json({ message: 'Failed to fetch lookups' });
  }
}