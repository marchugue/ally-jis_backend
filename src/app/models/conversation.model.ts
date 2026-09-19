import { supabaseAdmin } from '../../config/supabase';
import type { ConversationMemberRow, ConversationRow, MessageReactionRow, MessageRow } from '../types/conversation.types';

const MEMBER_PROFILE_COLUMNS = 'id, full_name, username, avatar_url, interests, course, department';

/**
 * Returns the conversation_ids the given user belongs to, excluding any
 * they've hidden from their own chat list (see hideForUser below).
 */
export async function findConversationIdsForUser(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId)
    .is('hidden_at', null);

  if (error) throw error;
  return (data ?? []).map((row) => row.conversation_id as string);
}

/**
 * "Delete" from the chat list — hides it for this member only. Doesn't
 * touch the conversation, messages, or the other member's view at all.
 */
export async function hideForUser(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversation_members')
    .update({ hidden_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Un-hides a conversation that was previously hidden — called from
 * sendMessage for the recipient(s) of a new message, so a chat someone
 * "deleted" reappears if the other person messages again, rather than
 * silently swallowing a message into a conversation they can't see.
 */
export async function unhideForUser(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversation_members')
    .update({ hidden_at: null })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .not('hidden_at', 'is', null); // skip the write entirely if it wasn't hidden
  if (error) throw error;
}

/**
 * "Delete permanently" — sets cleared_at so messages before this point
 * become invisible for this member, and also marks it hidden_at so it
 * drops off the inbox. The other participant's history is untouched.
 */
export async function clearForUser(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversation_members')
    .update({
      cleared_at: new Date().toISOString(),
      hidden_at: new Date().toISOString(),
    })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
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

export interface FindConversationsOptions {
  limit?: number;
  cursor?: string;
}

export interface PaginatedConversationsResult {
  conversations: ConversationRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Fetches conversations (with nested messages + member profiles) for the
 * given list of ids, newest-updated first. Used by both GET /conversations
 * (all of the user's conversation ids) and GET /conversations/:id (a
 * single-id list).
 */
export async function findConversationsByIds(conversationIds: string[]): Promise<ConversationRow[]> {
  const { conversations } = await findConversationsByIdsPaginated(conversationIds);
  return conversations;
}

/**
 * Fetches paginated conversations for the given list of ids, sorted newest-updated first.
 */
export async function findConversationsByIdsPaginated(
  conversationIds: string[],
  options?: FindConversationsOptions
): Promise<PaginatedConversationsResult> {
  if (conversationIds.length === 0) {
    return { conversations: [], hasMore: false, nextCursor: null };
  }

  let query = supabaseAdmin
    .from('conversations')
    .select(
      `id, updated_at,
       messages ( id, conversation_id, sender_id, content, image_url, created_at ),
       conversation_members ( conversation_id, user_id, last_read_at, icebreakers_enabled, profiles (${MEMBER_PROFILE_COLUMNS}) )`
    )
    .in('id', conversationIds);

  if (options?.cursor) {
    query = query.lt('updated_at', options.cursor);
  }

  const isPaginated = options?.limit !== undefined || options?.cursor !== undefined;
  const limit = options?.limit ?? 20;

  if (isPaginated) {
    query = query.order('updated_at', { ascending: false }).limit(limit + 1);
  } else {
    query = query.order('updated_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = (data as unknown as ConversationRow[]) ?? [];
  let hasMore = false;

  if (isPaginated && rows.length > limit) {
    hasMore = true;
    rows = rows.slice(0, limit);
  }

  const nextCursor = hasMore && rows.length > 0 ? rows[rows.length - 1].updated_at : null;

  return { conversations: rows, hasMore, nextCursor };
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
async function attachRepliedMessages(messages: MessageRow[]): Promise<MessageRow[]> {
  const replyIds = [
    ...new Set(messages.map((message) => message.reply_to_message_id).filter(Boolean)),
  ] as string[];

  if (replyIds.length === 0) return messages;

  const { data: replies, error } = await supabaseAdmin
    .from('messages')
    .select('id, sender_id, content, image_url')
    .in('id', replyIds);

  if (error) throw error;

  const replyById = new Map((replies ?? []).map((reply) => [reply.id as string, reply]));

  return messages.map((message) => ({
    ...message,
    replied_message: message.reply_to_message_id
      ? (replyById.get(message.reply_to_message_id) as MessageRow['replied_message']) ?? null
      : null,
  }));
}

async function attachReactions(messages: MessageRow[]): Promise<MessageRow[]> {
  const messageIds = messages.map((message) => message.id);
  if (messageIds.length === 0) return messages;

  const { data, error } = await supabaseAdmin
    .from('message_reactions')
    .select('message_id, user_id, emoji')
    .in('message_id', messageIds);

  if (error) throw error;

  const reactionsByMessage = new Map<string, MessageRow['reactions']>();
  for (const row of data ?? []) {
    const bucket = reactionsByMessage.get(row.message_id as string) ?? [];
    bucket.push({
      message_id: row.message_id as string,
      user_id: row.user_id as string,
      emoji: row.emoji as string,
    });
    reactionsByMessage.set(row.message_id as string, bucket);
  }

  return messages.map((message) => ({
    ...message,
    reactions: reactionsByMessage.get(message.id) ?? [],
  }));
}

async function attachMessageMetadata(messages: MessageRow[]): Promise<MessageRow[]> {
  const withReplies = await attachRepliedMessages(messages);
  return attachReactions(withReplies);
}

export interface FindMessagesOptions {
  limit?: number;
  before?: string;
}

export interface PaginatedMessagesResult {
  messages: MessageRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function findMessagesByConversation(
  conversationId: string,
  userId: string,
  options?: FindMessagesOptions,
): Promise<PaginatedMessagesResult> {
  // 1. Fetch the caller's cleared_at so we can filter pre-clear messages.
  const { data: memberData } = await supabaseAdmin
    .from('conversation_members')
    .select('cleared_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  const clearedAt: string | null = memberData?.cleared_at ?? null;

  // 2. Fetch messages, applying the cleared_at and before bounds if present.
  let query = supabaseAdmin
    .from('messages')
    .select('id, conversation_id, sender_id, content, image_url, created_at, reply_to_message_id, is_deleted, deleted_at')
    .eq('conversation_id', conversationId);

  if (clearedAt) {
    query = query.gt('created_at', clearedAt);
  }

  if (options?.before) {
    query = query.lt('created_at', options.before);
  }

  const isPaginated = options?.limit !== undefined || options?.before !== undefined;
  const limit = options?.limit ?? 30;

  if (isPaginated) {
    // When paginating, order DESC and fetch limit + 1 to detect hasMore
    query = query.order('created_at', { ascending: false }).limit(limit + 1);
  } else {
    query = query.order('created_at', { ascending: true });
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = (data as MessageRow[]) ?? [];
  let hasMore = false;

  if (isPaginated) {
    if (rows.length > limit) {
      hasMore = true;
      rows = rows.slice(0, limit);
    }
    // Reverse back to chronological order (oldest to newest)
    rows.reverse();
  }

  // 3. Filter out messages this user has individually deleted-for-themselves.
  if (rows.length > 0) {
    const messageIds = rows.map((m) => m.id);
    const { data: deletedRows } = await supabaseAdmin
      .from('deleted_messages_user')
      .select('message_id')
      .eq('user_id', userId)
      .in('message_id', messageIds);

    if (deletedRows && deletedRows.length > 0) {
      const deletedSet = new Set(deletedRows.map((r: { message_id: string }) => r.message_id));
      rows = rows.filter((m) => !deletedSet.has(m.id));
    }
  }

  const messages = await attachMessageMetadata(rows);
  const nextCursor = hasMore && messages.length > 0 ? messages[0].created_at : null;

  return { messages, hasMore, nextCursor };
}

export async function findMessageById(messageId: string): Promise<MessageRow | null> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('id, conversation_id, sender_id, content, image_url, created_at, reply_to_message_id, is_deleted, deleted_at')
    .eq('id', messageId)
    .maybeSingle();

  if (error) throw error;
  return (data as MessageRow | null) ?? null;
}

/**
 * "Delete for me" — inserts into the junction table so this message is
 * invisible to userId only; all other participants see it unchanged.
 * Uses upsert so a double-tap (idempotent call) doesn't throw a conflict.
 */
export async function deleteMessageForMe(messageId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('deleted_messages_user')
    .upsert(
      { user_id: userId, message_id: messageId },
      { onConflict: 'user_id,message_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

/**
 * "Delete for everyone" — tombstones the message: nulls content + image,
 * sets is_deleted = true. Everyone sees the placeholder bubble.
 */
export async function tombstoneMessage(messageId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('messages')
    .update({
      is_deleted: true,
      content: null,
      image_url: null,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', messageId);
  if (error) throw error;
}

/**
 * POST /conversations/:id/messages
 */
export async function insertMessage(input: {
  conversationId: string;
  senderId: string;
  content: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  replyToMessageId?: string | null;
}): Promise<MessageRow> {
  const { conversationId, senderId, content, imageUrl, imageUrls, replyToMessageId } = input;

  let resolvedImageUrl: string | null = null;
  if (Array.isArray(imageUrls) && imageUrls.length > 0) {
    resolvedImageUrl = imageUrls.length === 1 ? imageUrls[0] : JSON.stringify(imageUrls);
  } else if (imageUrl) {
    resolvedImageUrl = imageUrl;
  }

  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      image_url: resolvedImageUrl,
      reply_to_message_id: replyToMessageId ?? null,
    })
    .select('id, conversation_id, sender_id, content, image_url, created_at, reply_to_message_id')
    .single();

  if (error) throw error;
  const [message] = await attachMessageMetadata([data as MessageRow]);
  return message;
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
  conversationId?: string;
}): Promise<void> {
  const { userId, fromUserId, description, conversationId } = input;

  const descWithMeta = conversationId
    ? `<!--meta:${JSON.stringify({ targetId: conversationId })}-->${description}`
    : description;

  const insertPayload: Record<string, any> = {
    user_id: userId,
    type: 'message',
    title: 'New Message',
    description: descWithMeta,
    from_user_id: fromUserId,
  };
  if (conversationId) insertPayload.target_id = conversationId;

  let { error } = await supabaseAdmin.from('notifications').insert(insertPayload);

  if (error && (error.code === 'PGRST204' || error.message?.includes('target_id'))) {
    delete insertPayload.target_id;
    const retry = await supabaseAdmin.from('notifications').insert(insertPayload);
    error = retry.error;
  }

  if (error) {
    console.error('[createMessageNotification] Notification insert failed:', error);
  }
}

/**
 * Same purpose as createMessageNotification, but for a message sent
 * inside an anonymous match conversation. Deliberately omits
 * from_user_id — every other notification path joins that column
 * against profiles client-side to show a real name/avatar, which would
 * unmask the match partner the moment the notification bell renders.
 * The description can still include the message preview text; that's
 * not identity-revealing on its own.
 */
export async function createAnonymousMatchNotification(input: {
  userId: string;
  description: string;
  senderAlias?: string;
  conversationId?: string;
}): Promise<void> {
  const { userId, description, senderAlias = 'Anonymous Ally', conversationId } = input;
  const title = `${senderAlias} messaged you`;

  const descWithMeta = conversationId
    ? `<!--meta:${JSON.stringify({ targetId: conversationId })}-->${description}`
    : description;

  // Check if an unread anonymous match notification already exists for this user
  const { data: existing } = await supabaseAdmin
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'anon_match')
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const updatePayload: Record<string, any> = {
      title,
      description: descWithMeta,
      created_at: new Date().toISOString(),
    };
    if (conversationId) updatePayload.target_id = conversationId;

    let { error } = await supabaseAdmin
      .from('notifications')
      .update(updatePayload)
      .eq('id', existing.id);

    if (error && (error.code === 'PGRST204' || error.message?.includes('target_id'))) {
      delete updatePayload.target_id;
      const retry = await supabaseAdmin
        .from('notifications')
        .update(updatePayload)
        .eq('id', existing.id);
      error = retry.error;
    }

    if (error) {
      console.error('[createAnonymousMatchNotification] Notification update failed:', error);
    }
  } else {
    const insertPayload: Record<string, any> = {
      user_id: userId,
      type: 'anon_match',
      title,
      description: descWithMeta,
      from_user_id: null,
    };
    if (conversationId) insertPayload.target_id = conversationId;

    let { error } = await supabaseAdmin.from('notifications').insert(insertPayload);

    if (error && (error.code === 'PGRST204' || error.message?.includes('target_id'))) {
      delete insertPayload.target_id;
      const retry = await supabaseAdmin.from('notifications').insert(insertPayload);
      error = retry.error;
    }

    if (error) {
      console.error('[createAnonymousMatchNotification] Notification insert failed:', error);
    }
  }
}

export async function updateIcebreakersEnabled(conversationId: string, userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversation_members')
    .update({ icebreakers_enabled: enabled })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function geticebreakersEnabled(conversationId: string, userId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from('conversation_members')
    .select('icebreakers_enabled')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data?.icebreakers_enabled ?? null;
}

export async function setMessageReaction(input: {
  messageId: string;
  userId: string;
  emoji: string | null;
}): Promise<MessageReactionRow[]> {
  const { messageId, userId, emoji } = input;

  if (emoji === null) {
    const { error } = await supabaseAdmin
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId);

    if (error) throw error;
  } else {
    const { error } = await supabaseAdmin
      .from('message_reactions')
      .upsert(
        { message_id: messageId, user_id: userId, emoji },
        { onConflict: 'message_id,user_id' },
      );

    if (error) throw error;
  }

  const { data, error: fetchError } = await supabaseAdmin
    .from('message_reactions')
    .select('message_id, user_id, emoji')
    .eq('message_id', messageId);

  if (fetchError) throw fetchError;
  return (data as MessageReactionRow[]) ?? [];
}

export type { ConversationMemberRow };
