import { supabaseAdmin } from '../../config/supabase';

const ONLINE_WINDOW_SECONDS = 60;

/**
 * POST /presence/heartbeat
 * Upserts last_seen_at to now() for the current user. Requires the
 * user_presence table — see the migration noted in presence.routes.ts /
 * project README if it hasn't been run yet.
 */
export async function recordHeartbeat(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_presence')
    .upsert({ user_id: userId, last_seen_at: new Date().toISOString() }, { onConflict: 'user_id' });

  if (error) throw error;
}

/**
 * GET /presence/online
 * Returns user ids with a heartbeat in the last 60 seconds.
 */
export async function findOnlineUserIds(): Promise<string[]> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();

  const { data, error } = await supabaseAdmin.from('user_presence').select('user_id').gte('last_seen_at', cutoff);

  if (error) throw error;
  return (data ?? []).map((row) => row.user_id as string);
}
