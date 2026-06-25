import { supabaseAdmin } from '../../config/supabase';
import type { ProfileRow, UpdateProfilePayload } from '../types/profile.types';

const PROFILE_COLUMNS =
  'id, email, full_name, username, avatar_url, bio, department, course, year_level, interests, organizations, created_at';

/**
 * GET /profiles/me, GET /profiles/:userId
 */
export async function findById(id: string): Promise<ProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data as ProfileRow | null;
}

/**
 * GET /profiles?exclude={userId}
 * Lists every profile except the given id (used on the Discover screen
 * to exclude the current user from their own results).
 */
export async function findAllExcluding(excludeId?: string | null): Promise<ProfileRow[]> {
  let query = supabaseAdmin
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .order('created_at', { ascending: false });

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}

/**
 * POST /profiles/batch
 */
export async function findByIds(ids: string[]): Promise<ProfileRow[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabaseAdmin.from('profiles').select(PROFILE_COLUMNS).in('id', ids);

  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}

/**
 * Checks if a username is taken (case-insensitive).
 * Note: schema.sql declares `username text unique`, which is a
 * case-SENSITIVE constraint at the DB level. This app-level ilike check
 * is what actually enforces case-insensitive uniqueness.
 * excludeId lets PATCH /profiles/me check uniqueness against everyone else.
 */
export async function isUsernameTaken(username: string, excludeId?: string | null): Promise<boolean> {
  let query = supabaseAdmin.from('profiles').select('id').ilike('username', username).limit(1);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * PATCH /profiles/me
 * Builds a partial update — only fields actually present in the payload
 * are sent, so omitted fields are left untouched (no accidental nulling).
 * `updated_at` is set by schema.sql's `set_profiles_updated_at` trigger.
 */
export async function updateById(id: string, payload: UpdateProfilePayload): Promise<ProfileRow> {
  const updates: Record<string, unknown> = {};

  if (payload.full_name !== undefined) updates.full_name = payload.full_name;
  if (payload.username !== undefined) updates.username = payload.username?.toLowerCase();
  if (payload.bio !== undefined) updates.bio = payload.bio;
  if (payload.avatar_url !== undefined) updates.avatar_url = payload.avatar_url;
  if (payload.department !== undefined) updates.department = payload.department;
  if (payload.course !== undefined) updates.course = payload.course;
  if (payload.year_level !== undefined) updates.year_level = payload.year_level;
  if (payload.interests !== undefined) updates.interests = payload.interests;
  if (payload.organizations !== undefined) updates.organizations = payload.organizations;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', id)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) throw error;
  return data as ProfileRow;
}

/**
 * DELETE /profiles/me
 * Deletes the auth user — schema.sql's `profiles.id` FK references
 * `auth.users(id) on delete cascade`, so the profile row (and anything
 * else FK'd to it) is removed automatically.
 */
export async function deleteByAuthUserId(id: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) throw error;
}