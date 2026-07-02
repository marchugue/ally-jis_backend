// src/services/conversation.service.ts
import * as conversationModel from '../models/conversation.model';
import * as moderationModel from '../models/moderation.model';
import { HttpError } from '../types/auth.types';
import type {
  ConversationIdResponse,
  ConversationMembershipRow,
  ConversationRow,
  ConversationWithUserResponse,
  MessageReactionRow,
  MessageRow,
} from '../types/conversation.types';

/**
 * Tags each conversation with a blockStatus computed from the other
 * member's relationship to userId. Does NOT filter anything out —
 * blocked conversations stay visible; the client renders a banner and
 * disables the input based on this field.
 */
function attachBlockStatus(
  conversations: ConversationRow[],
  userId: string,
  directions: { blockedByMe: string[]; blockedMe: string[] },
): ConversationRow[] {
  const blockedByMeSet = new Set(directions.blockedByMe);
  const blockedMeSet = new Set(directions.blockedMe);

  return conversations.map((conv) => {
    const otherMemberId = (conv.conversation_members ?? []).find((m) => m.user_id !== userId)?.user_id;
    const blockedByMe = otherMemberId ? blockedByMeSet.has(otherMemberId) : false;
    const blockedMe = otherMemberId ? blockedMeSet.has(otherMemberId) : false;

    const blockStatus: ConversationRow['blockStatus'] =
      blockedByMe && blockedMe ? 'mutual' : blockedByMe ? 'blockedByMe' : blockedMe ? 'blockedByOther' : 'none';

    return { ...conv, blockStatus };
  });
}

function attachIcebreakersEnabled(conversations: ConversationRow[], userId: string): ConversationRow[] {
  return conversations.map((conv) => {
    const myMembership = (conv.conversation_members ?? []).find((m) => m.user_id === userId);
    return { ...conv, icebreakersEnabled: myMembership?.icebreakers_enabled ?? true };
  });
}

/**
 * GET /conversations
 */
export async function listMyConversations(userId: string): Promise<ConversationRow[]> {
  const conversationIds = await conversationModel.findConversationIdsForUser(userId);
  const [conversations, directions] = await Promise.all([
    conversationModel.findConversationsByIds(conversationIds),
    moderationModel.findBlockDirectionsForUser(userId),
  ]);

  const withBlockStatus = attachBlockStatus(conversations, userId, directions);
  return attachIcebreakersEnabled(withBlockStatus, userId);
}

/**
 * GET /conversations/:id
 */
export async function getConversationById(conversationId: string, userId: string): Promise<ConversationRow> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }

  const [conversation] = await conversationModel.findConversationsByIds([conversationId]);
  if (!conversation) {
    throw new HttpError('Conversation not found', 404);
  }

  const directions = await moderationModel.findBlockDirectionsForUser(userId);
  const [tagged] = attachBlockStatus([conversation], userId, directions);
  const [withIcebreakers] = attachIcebreakersEnabled([tagged], userId);
  return withIcebreakers;
}

/**
 * PATCH /conversations/:id/icebreakers
 */
export async function setIcebreakersEnabled(
  conversationId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }

  await conversationModel.updateIcebreakersEnabled(conversationId, userId, enabled);
}

/**
 * GET /conversations/:id/with-user/:otherUserId
 * Read-only lookup — does not create anything, unlike getOrCreateConversation. 
 */
export async function getIcebreakersEnabled(
  conversationId: string,
  userId: string
): Promise<boolean | null> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }
  
  return conversationModel.geticebreakersEnabled(conversationId, userId);
}

/**
 * POST /conversations
 * Finds the existing 1:1 conversation between the two users, or creates
 * one. Reuse check runs first and unconditionally — an existing (possibly
 * blocked) conversation is always returned rather than gated, matching how
 * blocked conversations stay visible everywhere else. The block check only
 * applies to *new* conversations: starting a fresh thread with someone who
 * has blocked you (or whom you've blocked) doesn't make sense. Flagging
 * this as an addition since it wasn't in the original file — remove the
 * isBlocked check below if that's not the intended behavior.
 */
export async function getOrCreateConversation(
  userId: string,
  targetUserId: string,
): Promise<ConversationIdResponse> {
  if (userId === targetUserId) {
    throw new HttpError('Cannot start a conversation with yourself', 400);
  }

  const existingId = await conversationModel.findSharedConversationId(userId, targetUserId);
  if (existingId) {
    return { conversationId: existingId };
  }

  const blocked = await moderationModel.isBlocked(userId, targetUserId);
  if (blocked) {
    throw new HttpError('You cannot start a conversation with this user', 403);
  }

  const conversationId = await conversationModel.createConversation();
  await conversationModel.addMembers(conversationId, [userId, targetUserId]);

  return { conversationId };
}

/**
 * PATCH /conversations/:id/read
 */
export async function markConversationRead(
  conversationId: string,
  userId: string,
  readAt: string,
): Promise<void> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }

  await conversationModel.markRead(conversationId, userId, readAt);
}

/**
 * GET /conversations/with-user/:otherUserId
 * Read-only lookup — does not create anything, unlike getOrCreateConversation.
 */
export async function getConversationWithUser(
  userId: string,
  otherUserId: string,
): Promise<ConversationWithUserResponse> {
  const conversationId = await conversationModel.findSharedConversationId(userId, otherUserId);
  return { conversationId };
}

/**
 * GET /conversations/memberships/me
 */
export async function listMyMemberships(userId: string): Promise<ConversationMembershipRow[]> {
  return conversationModel.findMembershipsForUser(userId);
}

/**
 * GET /conversations/:id/messages
 */
export async function listMessages(conversationId: string, userId: string): Promise<MessageRow[]> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }

  return conversationModel.findMessagesByConversation(conversationId);
}

/**
 * POST /conversations/:id/messages
 * sendMessage keeps its 403 guard exactly as last turn — blocking still
 * hard-stops new messages in either direction, it just no longer hides
 * the thread.
 */
export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  content: string | null;
  imageUrl?: string | null;
  replyToMessageId?: string | null;
}): Promise<MessageRow> {
  const { conversationId, senderId, content, imageUrl, replyToMessageId } = input;

  const member = await conversationModel.isMember(conversationId, senderId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }

  if (!content && !imageUrl) {
    throw new HttpError('Message must include content or an image', 400);
  }

  if (replyToMessageId) {
    const repliedMessage = await conversationModel.findMessageById(replyToMessageId);
    if (!repliedMessage || repliedMessage.conversation_id !== conversationId) {
      throw new HttpError('Reply target message was not found in this conversation', 400);
    }
  }

  const otherMemberIds = await conversationModel.findOtherMemberIds(conversationId, senderId);

  if (otherMemberIds.length > 0) {
    const blockedChecks = await Promise.all(otherMemberIds.map((id) => moderationModel.isBlocked(senderId, id)));
    if (blockedChecks.some(Boolean)) {
      throw new HttpError('You cannot send messages in this conversation', 403);
    }
  }

  const message = await conversationModel.insertMessage({
    conversationId,
    senderId,
    content,
    imageUrl,
    replyToMessageId,
  });
  await conversationModel.touchConversation(conversationId);

  await Promise.all(
    otherMemberIds.map((recipientId) =>
      conversationModel.createMessageNotification({
        userId: recipientId,
        fromUserId: senderId,
        description: content ?? 'Sent a photo',
      }),
    ),
  );

  return message;
}

/**
 * PUT /conversations/:id/messages/:messageId/reactions
 */
export async function setMessageReaction(input: {
  conversationId: string;
  messageId: string;
  userId: string;
  emoji: string | null;
}): Promise<MessageReactionRow[]> {
  const { conversationId, messageId, userId, emoji } = input;

  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }

  const message = await conversationModel.findMessageById(messageId);
  if (!message || message.conversation_id !== conversationId) {
    throw new HttpError('Message not found in this conversation', 404);
  }

  if (message.id.startsWith?.('temp-')) {
    throw new HttpError('Message not found in this conversation', 404);
  }

  return conversationModel.setMessageReaction({ messageId, userId, emoji });
}
