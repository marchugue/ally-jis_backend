// src/models/moderation.model.ts
import { supabaseAdmin } from '../../config/supabase';
import type {
  BlockRow,
  ReportRow,
  CreateReportParams,
  RestrictRow,
  MuteRow,
} from '../types/moderation.types';
import { FALLBACK_VIOLATION_ID, findTaxonomyViolation } from '../constants/reportTaxonomy';

/**
 * Upserts a block row. onConflict on (blocker_id, blocked_id) so
 * re-blocking an already blocked user refreshes the timestamp instead of
 * throwing a duplicate-key error.
 */
export async function createBlock(blockerId: string, blockedId: string): Promise<BlockRow> {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedId, created_at: new Date().toISOString() },
      { onConflict: 'blocker_id,blocked_id' },
    )
    .select('blocker_id, blocked_id, created_at')
    .single();

  if (error) throw error;
  return data as BlockRow;
}

export async function isBlocked(userId: string, otherUserId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocker_id')
    .or(
      `and(blocker_id.eq.${userId},blocked_id.eq.${otherUserId}),and(blocker_id.eq.${otherUserId},blocked_id.eq.${userId})`,
    )
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Removes any pending/accepted interaction rows between the two users in
 * both directions, so a blocked contact also disappears from connections.
 *
 * Note: no transaction client here (Supabase JS has no cross-call
 * transaction support like PoolClient did). If createBlock +
 * deleteInteractionsBetween need to be atomic, call them from the service
 * layer back-to-back, or wrap both in a Postgres RPC function.
 */
export async function deleteInteractionsBetween(userId: string, otherUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_interactions')
    .delete()
    .or(
      `and(user_id.eq.${userId},target_user_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},target_user_id.eq.${userId})`,
    );

  if (error) throw error;
}

/**
 * Makes sure the violation (and its category) exist in the lookup tables so the
 * reports.violation_id FK never rejects a valid community-standard id. Unknown
 * ids fall back to 'other-unspecified'. Returns the id that should be stored.
 */
async function ensureViolation(violationId: string): Promise<string> {
  const tax = findTaxonomyViolation(violationId) ?? findTaxonomyViolation(FALLBACK_VIOLATION_ID);
  if (!tax) return violationId;

  const { data: existing } = await supabaseAdmin
    .from('violations')
    .select('id')
    .eq('id', tax.id)
    .maybeSingle();
  if (existing) return tax.id;

  const { error: catError } = await supabaseAdmin.from('report_categories').upsert(
    {
      id: tax.categoryId,
      label: tax.categoryLabel,
      description: tax.categoryDescription,
      sort_order: tax.categorySortOrder,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (catError) console.error('[moderation.ensureViolation] category upsert failed:', catError);

  const { error: vioError } = await supabaseAdmin.from('violations').upsert(
    {
      id: tax.id,
      category_id: tax.categoryId,
      label: tax.label,
      description: tax.description,
      sort_order: tax.sortOrder,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (vioError) console.error('[moderation.ensureViolation] violation upsert failed:', vioError);

  return tax.id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createReport({
  reporterId,
  reportedUserId,
  violationId,
  conversationId,
  postId,
  messageId,
  notes,
}: CreateReportParams): Promise<ReportRow> {
  const storedViolationId = await ensureViolation(violationId);
  let resolvedConversationId = conversationId ?? null;

  const insertPayload: Record<string, any> = {
    reporter_id: reporterId,
    reported_user_id: reportedUserId,
    violation_id: storedViolationId,
    conversation_id: resolvedConversationId,
  };

  const safeMessageId = messageId && UUID_RE.test(messageId) ? messageId : null;
  const safePostId = postId && UUID_RE.test(postId) ? postId : null;
  const trimmedNotes = notes ? notes.trim() : '';

  if (safeMessageId) {
    if (!resolvedConversationId) {
      const { data: msg } = await supabaseAdmin
        .from('messages')
        .select('conversation_id')
        .eq('id', safeMessageId)
        .maybeSingle();
      resolvedConversationId = (msg?.conversation_id as string | undefined) ?? null;
      insertPayload.conversation_id = resolvedConversationId;
    }
    insertPayload.internal_notes = `[MSG:${safeMessageId}]${trimmedNotes ? ' ' + trimmedNotes : ''}`;
  } else if (safePostId) {
    insertPayload.internal_notes = `[POST:${safePostId}]${trimmedNotes ? ' ' + trimmedNotes : ''}`;
  } else if (trimmedNotes) {
    insertPayload.internal_notes = trimmedNotes;
  }

  const { data, error } = await supabaseAdmin
    .from('reports')
    .insert(insertPayload)
    .select('id, created_at')
    .single();

  if (error) throw error;
  return data as ReportRow;
}

/**
 * Returns the ids of every user blocked in either direction with `userId`
 * — people they've blocked, and people who've blocked them. Used to filter
 * conversations and gate message-sending symmetrically for both sides.
 */
export async function findBlockedUserIds(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

  if (error) throw error;
  return (data ?? []).map((row) =>
    row.blocker_id === userId ? (row.blocked_id as string) : (row.blocker_id as string),
  );
}

// src/models/moderation.model.ts (additions)

export interface BlockDirections {
  blockedByMe: string[];
  blockedMe: string[];
}

/**
 * Removes a block row. No-op (not an error) if it doesn't exist.
 */
export async function deleteBlock(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);

  if (error) throw error;
}

/**
 * Returns both directions of blocking for a user in one query: who they've
 * blocked, and who has blocked them. Used to compute per-conversation
 * blockStatus without hiding the conversation.
 */
export async function findBlockDirectionsForUser(userId: string): Promise<BlockDirections> {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

  if (error) throw error;
  const rows = data ?? [];

  return {
    blockedByMe: rows.filter((r) => r.blocker_id === userId).map((r) => r.blocked_id as string),
    blockedMe: rows.filter((r) => r.blocked_id === userId).map((r) => r.blocker_id as string),
  };
}

/**
 * Fetches everyone `userId` has blocked, with their profile info, for the
 * blocklist page. Relies on the blocks.blocked_id -> profiles.id FK.
 */
export async function findBlockedUsersWithProfiles(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocked_id, created_at, profiles:blocked_id (id, full_name, username, avatar_url)')
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// User Restrictions (Presence Hiding)
// ─────────────────────────────────────────────────────────────────────────────

// Fallback in-memory map in case migration hasn't been executed yet in the Supabase DB
const memoryRestrictions = new Map<string, { restricter_id: string; restricted_id: string; created_at: string }>();

function memoryRestrictionKey(a: string, b: string): string {
  return `${a}:::${b}`;
}

export async function createRestriction(restricterId: string, restrictedId: string): Promise<RestrictRow> {
  const row: RestrictRow = {
    restricter_id: restricterId,
    restricted_id: restrictedId,
    created_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabaseAdmin
      .from('user_restrictions')
      .upsert(row, { onConflict: 'restricter_id,restricted_id' })
      .select('restricter_id, restricted_id, created_at')
      .single();

    if (error) {
      console.warn('[moderation.createRestriction] Supabase table error, using in-memory store:', error.message);
      memoryRestrictions.set(memoryRestrictionKey(restricterId, restrictedId), row);
      return row;
    }
    return data as RestrictRow;
  } catch (err) {
    console.warn('[moderation.createRestriction] Fallback to in-memory:', err);
    memoryRestrictions.set(memoryRestrictionKey(restricterId, restrictedId), row);
    return row;
  }
}

export async function deleteRestriction(restricterId: string, restrictedId: string): Promise<void> {
  memoryRestrictions.delete(memoryRestrictionKey(restricterId, restrictedId));
  try {
    const { error } = await supabaseAdmin
      .from('user_restrictions')
      .delete()
      .eq('restricter_id', restricterId)
      .eq('restricted_id', restrictedId);

    if (error && error.code !== '42P01') {
      console.warn('[moderation.deleteRestriction] Supabase error:', error.message);
    }
  } catch (err) {
    console.warn('[moderation.deleteRestriction] Fallback error ignored:', err);
  }
}

export async function isRestrictedBy(restricterId: string, restrictedId: string): Promise<boolean> {
  if (memoryRestrictions.has(memoryRestrictionKey(restricterId, restrictedId))) {
    return true;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('user_restrictions')
      .select('restricter_id')
      .eq('restricter_id', restricterId)
      .eq('restricted_id', restrictedId)
      .limit(1);

    if (error) {
      return memoryRestrictions.has(memoryRestrictionKey(restricterId, restrictedId));
    }
    return (data?.length ?? 0) > 0;
  } catch {
    return memoryRestrictions.has(memoryRestrictionKey(restricterId, restrictedId));
  }
}

/**
 * Checks if a restriction exists in EITHER direction between user A and user B.
 */
export async function isRestricted(userId: string, otherUserId: string): Promise<boolean> {
  if (
    memoryRestrictions.has(memoryRestrictionKey(userId, otherUserId)) ||
    memoryRestrictions.has(memoryRestrictionKey(otherUserId, userId))
  ) {
    return true;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('user_restrictions')
      .select('restricter_id')
      .or(
        `and(restricter_id.eq.${userId},restricted_id.eq.${otherUserId}),and(restricter_id.eq.${otherUserId},restricted_id.eq.${userId})`,
      )
      .limit(1);

    if (error) {
      return (
        memoryRestrictions.has(memoryRestrictionKey(userId, otherUserId)) ||
        memoryRestrictions.has(memoryRestrictionKey(otherUserId, userId))
      );
    }
    return (data?.length ?? 0) > 0;
  } catch {
    return (
      memoryRestrictions.has(memoryRestrictionKey(userId, otherUserId)) ||
      memoryRestrictions.has(memoryRestrictionKey(otherUserId, userId))
    );
  }
}

/**
 * Returns all user IDs that have a restriction in EITHER direction with `userId`.
 * Used for filtering mutual presence so neither party sees the other online.
 */
export async function findRestrictedUserIds(userId: string): Promise<string[]> {
  const result = new Set<string>();

  // Check in-memory store
  for (const [key, val] of memoryRestrictions.entries()) {
    if (val.restricter_id === userId) result.add(val.restricted_id);
    if (val.restricted_id === userId) result.add(val.restricter_id);
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('user_restrictions')
      .select('restricter_id, restricted_id')
      .or(`restricter_id.eq.${userId},restricted_id.eq.${userId}`);

    if (!error && data) {
      for (const row of data) {
        if (row.restricter_id === userId) result.add(row.restricted_id as string);
        else result.add(row.restricter_id as string);
      }
    }
  } catch (err) {
    console.warn('[moderation.findRestrictedUserIds] Supabase query error:', err);
  }

  return Array.from(result);
}

export async function findRestrictedUsersWithProfiles(userId: string) {
  let rows: any[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('user_restrictions')
      .select('restricted_id, created_at, profiles:restricted_id (id, full_name, username, avatar_url)')
      .eq('restricter_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      rows = data;
    }
  } catch (err) {
    console.warn('[moderation.findRestrictedUsersWithProfiles] Supabase join error:', err);
  }

  // Merge in-memory restrictions if any exist
  const existingRestrictedIds = new Set(rows.map((r) => r.restricted_id));
  const missingIds: string[] = [];
  const memoryRows: any[] = [];

  for (const [_, val] of memoryRestrictions.entries()) {
    if (val.restricter_id === userId && !existingRestrictedIds.has(val.restricted_id)) {
      missingIds.push(val.restricted_id);
      memoryRows.push({
        restricted_id: val.restricted_id,
        created_at: val.created_at,
        profiles: null,
      });
    }
  }

  if (missingIds.length > 0) {
    try {
      const { data: profs } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .in('id', missingIds);
      const profMap = new Map((profs ?? []).map((p) => [p.id, p]));
      for (const mr of memoryRows) {
        mr.profiles = profMap.get(mr.restricted_id) ?? null;
      }
    } catch {}
    rows.push(...memoryRows);
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// User Mutes (Notification Suppression)
// ─────────────────────────────────────────────────────────────────────────────

const memoryMutes = new Map<string, { muter_id: string; muted_id: string; created_at: string }>();

function memoryMuteKey(a: string, b: string): string {
  return `${a}:::${b}`;
}

export async function createMute(muterId: string, mutedId: string): Promise<MuteRow> {
  const row: MuteRow = {
    muter_id: muterId,
    muted_id: mutedId,
    created_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabaseAdmin
      .from('user_mutes')
      .upsert(row, { onConflict: 'muter_id,muted_id' })
      .select('muter_id, muted_id, created_at')
      .single();

    if (error) {
      console.warn('[moderation.createMute] Supabase table error, using in-memory store:', error.message);
      memoryMutes.set(memoryMuteKey(muterId, mutedId), row);
      return row;
    }
    return data as MuteRow;
  } catch (err) {
    console.warn('[moderation.createMute] Fallback to in-memory:', err);
    memoryMutes.set(memoryMuteKey(muterId, mutedId), row);
    return row;
  }
}

export async function deleteMute(muterId: string, mutedId: string): Promise<void> {
  memoryMutes.delete(memoryMuteKey(muterId, mutedId));
  try {
    const { error } = await supabaseAdmin
      .from('user_mutes')
      .delete()
      .eq('muter_id', muterId)
      .eq('muted_id', mutedId);

    if (error && error.code !== '42P01') {
      console.warn('[moderation.deleteMute] Supabase error:', error.message);
    }
  } catch (err) {
    console.warn('[moderation.deleteMute] Fallback error ignored:', err);
  }
}

/**
 * Checks if `muterId` has muted `targetUserId`.
 */
export async function isMuted(muterId: string, targetUserId: string): Promise<boolean> {
  if (memoryMutes.has(memoryMuteKey(muterId, targetUserId))) {
    return true;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('user_mutes')
      .select('muter_id')
      .eq('muter_id', muterId)
      .eq('muted_id', targetUserId)
      .limit(1);

    if (error) {
      return memoryMutes.has(memoryMuteKey(muterId, targetUserId));
    }
    return (data?.length ?? 0) > 0;
  } catch {
    return memoryMutes.has(memoryMuteKey(muterId, targetUserId));
  }
}

export async function findMutedUserIds(muterId: string): Promise<string[]> {
  const result = new Set<string>();
  for (const [_, val] of memoryMutes.entries()) {
    if (val.muter_id === muterId) result.add(val.muted_id);
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('user_mutes')
      .select('muted_id')
      .eq('muter_id', muterId);

    if (!error && data) {
      for (const row of data) {
        result.add(row.muted_id as string);
      }
    }
  } catch (err) {
    console.warn('[moderation.findMutedUserIds] Supabase query error:', err);
  }

  return Array.from(result);
}

export async function findMutedUsersWithProfiles(muterId: string) {
  let rows: any[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('user_mutes')
      .select('muted_id, created_at, profiles:muted_id (id, full_name, username, avatar_url)')
      .eq('muter_id', muterId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      rows = data;
    }
  } catch (err) {
    console.warn('[moderation.findMutedUsersWithProfiles] Supabase join error:', err);
  }

  const existingMutedIds = new Set(rows.map((r) => r.muted_id));
  const missingIds: string[] = [];
  const memoryRows: any[] = [];

  for (const [_, val] of memoryMutes.entries()) {
    if (val.muter_id === muterId && !existingMutedIds.has(val.muted_id)) {
      missingIds.push(val.muted_id);
      memoryRows.push({
        muted_id: val.muted_id,
        created_at: val.created_at,
        profiles: null,
      });
    }
  }

  if (missingIds.length > 0) {
    try {
      const { data: profs } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .in('id', missingIds);
      const profMap = new Map((profs ?? []).map((p) => [p.id, p]));
      for (const mr of memoryRows) {
        mr.profiles = profMap.get(mr.muted_id) ?? null;
      }
    } catch {}
    rows.push(...memoryRows);
  }

  return rows;
}