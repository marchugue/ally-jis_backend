import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { testDatabaseConnection } from '../config/database';
import { env } from '../config/env';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'ally-jis-api',
    supabaseUrl: env.SUPABASE_URL,
  });
});

/** Test Supabase JS client (REST API to your project) */
router.get('/supabase', async (_req, res, next) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    if (error) {
      res.status(503).json({
        ok: false,
        message: error.message,
        hint: 'Run AFFP2/supabase/schema.sql in Supabase SQL Editor if tables are missing.',
      });
      return;
    }

    res.json({
      ok: true,
      connection: 'supabase-js',
      profilesCount: count ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

/** Test direct    pool (optional DATABASE_URL) */
router.get('/database', async (_req, res) => {
  if (!env.DATABASE_URL) {
    res.json({
      ok: false,
      connection: 'pg',
      message: 'DATABASE_URL not configured (optional). Supabase JS client still works.',
    });
    return;
  }

  const connected = await testDatabaseConnection();
  res.json({
    ok: connected,
    connection: 'pg',
  });
});

export default router;
