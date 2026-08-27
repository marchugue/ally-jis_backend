import { supabaseAdmin } from '../../config/supabase';
import type { AllyListItem, InteractionRow, InteractionStatus } from '../types/interaction.types';

/**
 * GET /interactions
 * All interactions the current user initiated.
 */
export async function findAllByUser(userId: string): Promise<InteractionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select('user_id, target_user_id, status, accepted_at')
    .eq('user_id', userId);

  if (error) throw error;
  return (data as InteractionRow[]) ?? [];
}

/**
 * POST /interactions/incoming
 * Interactions directed AT the current user, filtered to a given set of
 * requester ids (the frontend already knows which profiles it's asking about).
 */
export async function findIncomingFromRequesters(
  targetUserId: string,
  requesterIds: string[]
): Promise<InteractionRow[]> {
  if (requesterIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select('user_id, target_user_id, status, accepted_at')
    .eq('target_user_id', targetUserId)
    .in('user_id', requesterIds);

  if (error) throw error;
  return (data as InteractionRow[]) ?? [];
}

/**
 * Upserts a single interaction row (used by request/reject, and by the
 * accept flow to flip both directions to 'accepted').
 * Relies on the unique(user_id, target_user_id) constraint in schema.sql.
 */
export async function upsertInteraction(input: {
  userId: string;
  targetUserId: string;
  status: InteractionStatus;
  acceptedAt?: string | null;
}): Promise<void> {
  const { userId, targetUserId, status, acceptedAt = null } = input;

  const { error } = await supabaseAdmin.from('user_interactions').upsert(
    {
      user_id: userId,
      target_user_id: targetUserId,
      status,
      accepted_at: acceptedAt,
    },
    { onConflict: 'user_id,target_user_id' }
  );

  if (error) throw error;
}

/**
 * Marks the requester -> current-user row as accepted (step 1 of accept).
 */
export async function markAccepted(userId: string, targetUserId: string, acceptedAt: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_interactions')
    .update({ status: 'accepted', accepted_at: acceptedAt })
    .eq('user_id', userId)
    .eq('target_user_id', targetUserId);

  if (error) throw error;
}

/**
 * GET /interactions/status/:targetUserId
 */
export async function findStatus(userId: string, targetUserId: string): Promise<InteractionStatus | null> {
  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select('status')
    .eq('user_id', userId)
    .eq('target_user_id', targetUserId)
    .maybeSingle();

  if (error) throw error;
  return (data as { status: InteractionStatus } | null)?.status ?? null;
}

/**
 * Cancels a pending request the caller sent — deletes the row entirely
 * (not a status flip) so a fresh request later behaves the same as a
 * first-ever request. Scoped to `status = 'pending'` so this can't be
 * used to unilaterally erase an already-accepted relationship — that's
 * removeAlly's job, and it has to clear both directions.
 */
export async function cancelPendingRequest(userId: string, targetUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_interactions')
    .delete()
    .eq('user_id', userId)
    .eq('target_user_id', targetUserId)
    .eq('status', 'pending');
  if (error) throw error;
}

/**
 * Removes an accepted ally relationship — deletes both directions.
 * Deliberately leaves the shared conversation and its messages alone;
 * unfriending isn't meant to erase chat history.
 */
export async function removeAllyRows(userIdA: string, userIdB: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_interactions')
    .delete()
    .or(
      `and(user_id.eq.${userIdA},target_user_id.eq.${userIdB}),and(user_id.eq.${userIdB},target_user_id.eq.${userIdA})`,
    );
  if (error) throw error;
}

const ALLY_PROFILE_COLUMNS = 'id, username, full_name, avatar_url, course';

/** Simple offset pagination, same rationale as follow.model.ts's lists —
 * not expected to reach a scale where keyset pagination earns its
 * complexity. */
export async function listAllies(userId: string, limit: number, offset: number): Promise<AllyListItem[]> {
  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select(`accepted_at, target:profiles!user_interactions_target_user_id_fkey(${ALLY_PROFILE_COLUMNS})`)
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .order('accepted_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? [])
    .filter((row: any) => row.target)
    .map((row: any) => ({
      id: row.target.id,
      username: row.target.username ?? null,
      fullName: row.target.full_name ?? null,
      avatarUrl: row.target.avatar_url ?? null,
      course: row.target.course ?? null,
      alliedAt: row.accepted_at,
    }));
}

export async function getAlliesCount(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('user_interactions')
    .select('target_user_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'accepted');
  if (error) throw error;
  return count ?? 0;
}

/** Raw id set of accepted allies — used for mutual-allies computation. */
export async function getAllyIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select('target_user_id')
    .eq('user_id', userId)
    .eq('status', 'accepted');
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.target_user_id as string));
}

/**
 * Finds a conversation shared by both users (mirrors get_shared_conversation
 * in schema.sql), used by the accept flow to avoid creating duplicate
 * conversations when one already exists.
 */
export async function findSharedConversationId(userIdA: string, userIdB: string): Promise<string | null> {
  const { data: ownRows, error: ownError } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userIdA);

  if (ownError) throw ownError;

  const conversationIds = (ownRows ?? []).map((row) => row.conversation_id as string);
  if (conversationIds.length === 0) return null;

  const { data: sharedRows, error: sharedError } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userIdB)
    .in('conversation_id', conversationIds)
    .limit(1);

  if (sharedError) throw sharedError;
  return (sharedRows?.[0]?.conversation_id as string | undefined) ?? null;
}

/**
 * Creates a new conversation row, returning its id.
 */
export async function createConversation(): Promise<string> {
  const { data, error } = await supabaseAdmin.from('conversations').insert({}).select('id').single();

  if (error) throw error;
  return (data as { id: string }).id;
}

/**
 * Adds both users as members of a conversation. Uses upsert so this is
 * safe to call even if one of them is already a member.
 */
export async function addConversationMembers(conversationId: string, userIds: string[]): Promise<void> {
  const rows = userIds.map((userId) => ({ conversation_id: conversationId, user_id: userId }));

  const { error } = await supabaseAdmin
    .from('conversation_members')
    .upsert(rows, { onConflict: 'conversation_id,user_id' });

  if (error) throw error;
}

/**
 * Inserts a notification row. Shared by request/accept flows.
 */
export async function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  description: string;
  fromUserId?: string | null;
}): Promise<void> {
  const { userId, type, title, description, fromUserId } = input;

  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    type,
    title,
    description,
    from_user_id: fromUserId ?? null,
  });

  if (error) throw error;
}
