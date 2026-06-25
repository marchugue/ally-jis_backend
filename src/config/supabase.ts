import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Admin client — bypasses Row Level Security.
 * Use only on the server. Never expose SERVICE_ROLE_KEY to the web/app.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Public client — same key as frontend (anon/publishable).
 * Use for sign-in flows that should respect Supabase Auth behavior.
 */
export const supabasePublic: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
