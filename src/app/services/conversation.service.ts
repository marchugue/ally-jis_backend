// src/services/conversation.service.ts
import * as conversationModel from '../models/conversation.model';
import * as moderationModel from '../models/moderation.model';
import * as matchModel from '../models/matchmaking.model';
import * as matchmakingService from './matchmaking.service';
import { emitToUser } from './realtime.service';
import { HttpError } from '../types/auth.types';
import type {
  ConversationIdResponse,
  ConversationMembershipRow,
  ConversationRow,
  ConversationVariant,
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

const TERMINAL_MATCH_STATUSES = new Set(['declined', 'timed_out', 'expired', 'ended']);

/**
 * The one place a conversation's variant is decided, and the one place
 * real profile data gets stripped for a conversation that hasn't been
 * revealed yet. Every caller that returns a ConversationRow to a client
 * (list, getById) goes through this — there's no second code path that
 * could forget to anonymize.
 */
async function attachVariant(conversations: ConversationRow[], userId: string): Promise<ConversationRow[]> {
  const matchInfoByConversation = await matchModel.findMatchInfoForConversations(
    conversations.map((c) => c.id),
    userId,
  );

  return conversations.map((conv) => {
    const match = matchInfoByConversation.get(conv.id);
    if (!match || match.revealedAt) {
      return { ...conv, variant: 'regular' as const, matchInfo: null };
    }

    const ended = TERMINAL_MATCH_STATUSES.has(match.status);
    const matchInfo = {
      matchId: match.matchId,
      stage: match.currentStage,
      dayStreak: match.dayStreak,
      myAlias: match.myAlias,
      myAvatar: match.myAvatar,
      partnerAlias: match.partnerAlias,
      partnerAvatar: match.partnerAvatar,
      ended,
    };

    // Strip real profile data for the other member(s) — defense in depth,
    // so an anonymous conversation never carries a real name/avatar to
    // the client even if a future caller forgets to check `variant`.
    const strippedMembers = (conv.conversation_members ?? []).map((member) =>
      member.user_id === userId ? member : { ...member, profiles: undefined },
    );

    const variant: ConversationVariant = ended ? 'anonymous_ended' : 'anonymous';

    return {
      ...conv,
      variant,
      matchInfo,
      conversation_members: strippedMembers,
    };
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
  const withIcebreakers = attachIcebreakersEnabled(withBlockStatus, userId);
  return attachVariant(withIcebreakers, userId);
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
  const [withVariant] = await attachVariant([withIcebreakers], userId);
  return withVariant;
}

/**
 * PATCH /conversations/:id/icebreakers
 */
/**
 * "Delete" from the chat list — hides it for the caller only, see
 * conversation.model.ts#hideForUser for what this does and doesn't touch.
 */
export async function hideConversation(conversationId: string, userId: string): Promise<void> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }
  await conversationModel.hideForUser(conversationId, userId);
}

/**
 * "Delete permanently" — sets cleared_at + hidden_at so messages prior
 * to the clear point become invisible for this user only. The other
 * participant retains full history. Reuses hideForUser semantics (the
 * conversation re-appears in inbox when a new message arrives).
 */
export async function clearConversation(conversationId: string, userId: string): Promise<void> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }
  await conversationModel.clearForUser(conversationId, userId);
}

/** Undoes hideConversation — used by the frontend's "Undo" toast after a
 * delete, not part of the normal message-arrival unhide path (that one
 * calls the model directly from sendMessage). */
export async function unhideConversation(conversationId: string, userId: string): Promise<void> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }
  await conversationModel.unhideForUser(conversationId, userId);
}

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

  // Pass userId so the model can apply cleared_at + deleted_messages_user scoping.
  return conversationModel.findMessagesByConversation(conversationId, userId);
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

  // A recipient who'd "deleted" this conversation from their list gets it
  // back the moment a new message arrives — same behavior as WhatsApp/
  // Messenger. No-ops (no write) for anyone who hadn't hidden it.
  await Promise.all(otherMemberIds.map((recipientId) => conversationModel.unhideForUser(conversationId, recipientId)));

  // Push to every other member's socket room for instant delivery — this
  // now runs for every conversation, not just matches. Persistence above
  // is the source of truth either way; this is purely "don't make the
  // recipient wait for a poll".
  for (const recipientId of otherMemberIds) {
    emitToUser(recipientId, 'conversation:message_new', { conversationId, message });
  }

  // A conversation tied to a live, not-yet-revealed anonymous match needs
  // different notification handling than a regular DM: the streak/stage
  // machine needs to know a message landed, and the notification must
  // never carry the real sender's id — the standard path below joins
  // from_user_id against profiles client-side, which would unmask the
  // match partner the instant the bell renders. Once a match is revealed
  // (see markRevealedIfMatched), it's just a regular conversation again —
  // falls through to the normal notification path below.
  const match = await matchModel.getMatchByConversationId(conversationId);

  if (match && !match.revealed_at) {
    await matchmakingService.recordMatchMessage(conversationId, senderId);

    await Promise.all(
      otherMemberIds.map((recipientId) =>
        conversationModel.createAnonymousMatchNotification({
          userId: recipientId,
          description: content ?? 'Sent a photo',
        }),
      ),
    );
  } else {
    await Promise.all(
      otherMemberIds.map((recipientId) =>
        conversationModel.createMessageNotification({
          userId: recipientId,
          fromUserId: senderId,
          description: content ?? 'Sent a photo',
        }),
      ),
    );
  }

  return message;
}

/**
 * Typing indicator relay for any conversation (regular or anonymous —
 * unlike matchmaking's old relayTyping, this isn't match-specific).
 * Validates `fromUserId` is actually a member of `conversationId` before
 * relaying anywhere, so one user can't spoof a typing event into a
 * conversation they're not part of. Called from src/sockets/index.ts.
 */
export async function relayTyping(conversationId: string, fromUserId: string, isTyping: boolean): Promise<void> {
  const member = await conversationModel.isMember(conversationId, fromUserId);
  if (!member) return;

  const otherMemberIds = await conversationModel.findOtherMemberIds(conversationId, fromUserId);
  for (const recipientId of otherMemberIds) {
    emitToUser(recipientId, 'conversation:typing', { conversationId, isTyping });
  }
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

/**
 * DELETE /conversations/:id/messages/:messageId  (mode=delete_for_me)
 * Soft-deletes the message for the caller only. Available to any member.
 */
export async function deleteMessageForMe(
  conversationId: string,
  messageId: string,
  userId: string,
): Promise<void> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }

  const message = await conversationModel.findMessageById(messageId);
  if (!message || message.conversation_id !== conversationId) {
    throw new HttpError('Message not found in this conversation', 404);
  }

  await conversationModel.deleteMessageForMe(messageId, userId);
}

/**
 * DELETE /conversations/:id/messages/:messageId  (mode=delete_for_everyone)
 * Tombstones the message so all participants see the placeholder.
 * Only the original sender may perform this action.
 */
export async function deleteMessageForEveryone(
  conversationId: string,
  messageId: string,
  userId: string,
): Promise<void> {
  const member = await conversationModel.isMember(conversationId, userId);
  if (!member) {
    throw new HttpError('You are not a member of this conversation', 403);
  }

  const message = await conversationModel.findMessageById(messageId);
  if (!message || message.conversation_id !== conversationId) {
    throw new HttpError('Message not found in this conversation', 404);
  }

  if (message.sender_id !== userId) {
    throw new HttpError('Only the sender can delete a message for everyone', 403);
  }

  await conversationModel.tombstoneMessage(messageId);
}
