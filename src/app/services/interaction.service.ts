import * as interactionModel from '../models/interaction.model';
import { HttpError } from '../types/auth.types';
import type {
  AcceptConnectionResponse,
  ConnectionStatusResponse,
  InteractionRow,
} from '../types/interaction.types';

/**
 * GET /interactions
 */
export async function listMyInteractions(userId: string): Promise<InteractionRow[]> {
  return interactionModel.findAllByUser(userId);
}

/**
 * POST /interactions/incoming
 */
export async function listIncoming(targetUserId: string, requesterIds: string[]): Promise<InteractionRow[]> {
  return interactionModel.findIncomingFromRequesters(targetUserId, requesterIds);
}

/**
 * POST /interactions/request
 * Upserts a pending request and notifies the target user. If a request
 * already exists in any state it's reset back to pending (re-requesting
 * after a rejection is allowed), matching the ON CONFLICT...DO UPDATE in
 * the reference SQL.
 */
export async function requestConnection(userId: string, targetUserId: string): Promise<void> {
  if (userId === targetUserId) {
    throw new HttpError('Cannot send a connection request to yourself', 409);
  }

  await interactionModel.upsertInteraction({
    userId,
    targetUserId,
    status: 'pending',
    acceptedAt: null,
  });

  await interactionModel.createNotification({
    userId: targetUserId,
    type: 'friend_request',
    title: 'New Connection Request',
    description: 'Someone wants to connect with you! Check your requests to accept.',
    fromUserId: userId,
  });
}

/**
 * POST /interactions/accept
 * Mirrors accept_connection() in schema.sql: flips both directions to
 * accepted, finds-or-creates the shared conversation, adds both members,
 * and notifies the original requester.
 */
export async function acceptConnection(
  currentUserId: string,
  requesterId: string
): Promise<AcceptConnectionResponse> {
  const acceptedAt = new Date().toISOString();

  // 1. Mark the requester's original row accepted.
  await interactionModel.markAccepted(requesterId, currentUserId, acceptedAt);

  // 2. Upsert the reverse row so the connection is symmetric.
  await interactionModel.upsertInteraction({
    userId: currentUserId,
    targetUserId: requesterId,
    status: 'accepted',
    acceptedAt,
  });

  // 3. Find or create the shared conversation.
  let conversationId = await interactionModel.findSharedConversationId(currentUserId, requesterId);
  if (!conversationId) {
    conversationId = await interactionModel.createConversation();
  }

  // 4. Make sure both users are members.
  await interactionModel.addConversationMembers(conversationId, [currentUserId, requesterId]);

  // 5. Notify the requester their request was accepted.
  await interactionModel.createNotification({
    userId: requesterId,
    type: 'accepted',
    title: 'Request Accepted!',
    description: 'Your connection request was accepted. You can now message each other.',
    fromUserId: currentUserId,
  });

  return { conversationId };
}

/**
 * POST /interactions/reject
 */
export async function rejectConnection(userId: string, targetUserId: string): Promise<void> {
  await interactionModel.upsertInteraction({
    userId,
    targetUserId,
    status: 'rejected',
    acceptedAt: null,
  });
}

/**
 * GET /interactions/status/:targetUserId
 */
export async function getConnectionStatus(
  userId: string,
  targetUserId: string
): Promise<ConnectionStatusResponse> {
  const status = await interactionModel.findStatus(userId, targetUserId);
  return { status };
}
