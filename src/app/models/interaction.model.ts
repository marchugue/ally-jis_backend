import { supabaseAdmin } from '../../config/supabase';
import type { InteractionRow, InteractionStatus } from '../types/interaction.types';

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
  fromUserId: string;
}): Promise<void> {
  const { userId, type, title, description, fromUserId } = input;

  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    type,
    title,
    description,
    from_user_id: fromUserId,
  });

  if (error) throw error;
}
