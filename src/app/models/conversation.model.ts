import { supabaseAdmin } from '../../config/supabase';
import type { ConversationMemberRow, ConversationRow, MessageRow } from '../types/conversation.types';

const MEMBER_PROFILE_COLUMNS = 'id, full_name, username, avatar_url, interests';

/**
 * Returns the conversation_ids the given user belongs to.
 */
export async function findConversationIdsForUser(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId);

  if (error) throw error;
  return (data ?? []).map((row) => row.conversation_id as string);
}

/**
 * Checks whether a user is a member of a given conversation. Used to guard
 * GET /conversations/:id, GET /conversations/:id/messages, and
 * POST /conversations/:id/messages with a 403 in the service layer.
 */
export async function isMember(conversationId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

/**
 * Fetches conversations (with nested messages + member profiles) for the
 * given list of ids, newest-updated first. Used by both GET /conversations
 * (all of the user's conversation ids) and GET /conversations/:id (a
 * single-id list).
 */
export async function findConversationsByIds(conversationIds: string[]): Promise<ConversationRow[]> {
  if (conversationIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select(
      `id, updated_at,
       messages ( id, conversation_id, sender_id, content, image_url, created_at ),
       conversation_members ( conversation_id, user_id, last_read_at, profiles (${MEMBER_PROFILE_COLUMNS}) )`
    )
    .in('id', conversationIds)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data as unknown as ConversationRow[]) ?? [];
}

/**
 * Finds a conversation shared by both users (mirrors get_shared_conversation
 * in schema.sql).
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
 * Adds members to a conversation (upsert so it's safe to call repeatedly).
 */
export async function addMembers(conversationId: string, userIds: string[]): Promise<void> {
  const rows = userIds.map((userId) => ({ conversation_id: conversationId, user_id: userId }));

  const { error } = await supabaseAdmin
    .from('conversation_members')
    .upsert(rows, { onConflict: 'conversation_id,user_id' });

  if (error) throw error;
}

/**
 * PATCH /conversations/:id/read
 */
export async function markRead(conversationId: string, userId: string, readAt: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversation_members')
    .update({ last_read_at: readAt })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * GET /conversations/memberships/me
 */
export async function findMembershipsForUser(
  userId: string
): Promise<{ conversation_id: string; last_read_at: string | null }[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('user_id', userId);

  if (error) throw error;
  return data ?? [];
}

/**
 * GET /conversations/:id/messages
 */
export async function findMessagesByConversation(conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('id, conversation_id, sender_id, content, image_url, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data as MessageRow[]) ?? [];
}

/**
 * POST /conversations/:id/messages
 */
export async function insertMessage(input: {
  conversationId: string;
  senderId: string;
  content: string | null;
  imageUrl?: string | null;
}): Promise<MessageRow> {
  const { conversationId, senderId, content, imageUrl } = input;

  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      image_url: imageUrl ?? null,
    })
    .select('id, conversation_id, sender_id, content, image_url, created_at')
    .single();

  if (error) throw error;
  return data as MessageRow;
}

/**
 * Bumps conversations.updated_at — called after a new message so the
 * conversation list sorts most-recently-active first.
 */
export async function touchConversation(conversationId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  if (error) throw error;
}

/**
 * Returns the other member ids of a conversation (everyone except the
 * sender) — used to fan out the "New Message" notification.
 */
export async function findOtherMemberIds(conversationId: string, excludingUserId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .neq('user_id', excludingUserId);

  if (error) throw error;
  return (data ?? []).map((row) => row.user_id as string);
}

/**
 * Inserts a "New Message" notification for a conversation recipient.
 */
export async function createMessageNotification(input: {
  userId: string;
  fromUserId: string;
  description: string;
}): Promise<void> {
  const { userId, fromUserId, description } = input;

  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    type: 'message',
    title: 'New Message',
    description,
    from_user_id: fromUserId,
  });

  if (error) throw error;
}

export type { ConversationMemberRow };
