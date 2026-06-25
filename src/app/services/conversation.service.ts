import * as conversationModel from '../models/conversation.model';
import { HttpError } from '../types/auth.types';
import type {
  ConversationIdResponse,
  ConversationMembershipRow,
  ConversationRow,
  ConversationWithUserResponse,
  MessageRow,
} from '../types/conversation.types';

/**
 * GET /conversations
 */
export async function listMyConversations(userId: string): Promise<ConversationRow[]> {
  const conversationIds = await conversationModel.findConversationIdsForUser(userId);
  return conversationModel.findConversationsByIds(conversationIds);
}

/**
 * GET /conversations/:id
 * Throws 403 if the requester isn't a member, 404 if it doesn't exist.
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

  return conversation;
}

/**
 * POST /conversations
 * Mirrors get_or_create_conversation() in schema.sql.
 */
export async function getOrCreateConversation(
  userId: string,
  targetUserId: string
): Promise<ConversationIdResponse> {
  if (userId === targetUserId) {
    throw new HttpError('Cannot start a conversation with yourself', 409);
  }

  let conversationId = await conversationModel.findSharedConversationId(userId, targetUserId);

  if (!conversationId) {
    conversationId = await conversationModel.createConversation();
    await conversationModel.addMembers(conversationId, [userId, targetUserId]);
  }

  return { conversationId };
}

/**
 * PATCH /conversations/:id/read
 */
export async function markConversationRead(conversationId: string, userId: string, readAt?: string): Promise<void> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }

  await conversationModel.markRead(conversationId, userId, readAt ?? new Date().toISOString());
}

/**
 * GET /conversations/with-user/:otherUserId
 */
export async function getConversationWithUser(
  userId: string,
  otherUserId: string
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
 * Inserts the message, bumps the conversation's updated_at, and fans out
 * a "New Message" notification to the other member(s).
 */
export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  content: string | null;
  imageUrl?: string | null;
}): Promise<MessageRow> {
  const { conversationId, senderId, content, imageUrl } = input;

  const member = await conversationModel.isMember(conversationId, senderId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }

  if (!content && !imageUrl) {
    throw new HttpError('Message must include content or an image', 400);
  }

  const message = await conversationModel.insertMessage({ conversationId, senderId, content, imageUrl });
  await conversationModel.touchConversation(conversationId);

  const otherMemberIds = await conversationModel.findOtherMemberIds(conversationId, senderId);
  await Promise.all(
    otherMemberIds.map((recipientId) =>
      conversationModel.createMessageNotification({
        userId: recipientId,
        fromUserId: senderId,
        description: content ?? 'Sent a photo',
      })
    )
  );

  return message;
}
