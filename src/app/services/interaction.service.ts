import * as interactionModel from '../models/interaction.model';
import * as matchmakingService from './matchmaking.service';
import { HttpError } from '../types/auth.types';
import type {
  AcceptConnectionResponse,
  ConnectionStatusResponse,
  InteractionRow,
  PaginatedAllyList,
  RelationshipStatus,
  RelationshipStatusResponse,
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

  // 4b. If these two were an anonymous match, this is the reclassification
  // point — no-ops if they weren't matched, or already revealed.
  await matchmakingService.markRevealedIfMatched(currentUserId, requesterId);

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

/**
 * DELETE /interactions/request/:targetUserId
 * Cancels a request the caller sent. Rejects if the caller has no
 * pending outgoing request to that user (nothing to cancel) — the model
 * layer's DELETE is already scoped to status='pending' so this can't
 * accidentally remove an accepted ally relationship.
 */
export async function cancelRequest(userId: string, targetUserId: string): Promise<void> {
  await interactionModel.cancelPendingRequest(userId, targetUserId);
}

/**
 * DELETE /interactions/ally/:targetUserId
 * Removes an accepted ally relationship in both directions. Chat history
 * is untouched — see removeAllyRows.
 */
export async function removeAlly(userId: string, targetUserId: string): Promise<void> {
  await interactionModel.removeAllyRows(userId, targetUserId);
}

/**
 * GET /interactions/relationship/:targetUserId
 * The bidirectional status the profile page's relationship button
 * actually needs — findStatus alone only sees one direction, which
 * can't tell "I requested them" apart from "they requested me".
 * 'rejected' collapses into 'none' on both sides deliberately: a
 * rejection shouldn't be visible to the rejected party, and re-requesting
 * after one is explicitly allowed elsewhere (requestConnection's upsert).
 */
export async function getRelationshipStatus(userId: string, targetUserId: string): Promise<RelationshipStatusResponse> {
  const [mine, theirs] = await Promise.all([
    interactionModel.findStatus(userId, targetUserId),
    interactionModel.findStatus(targetUserId, userId),
  ]);

  let status: RelationshipStatus = 'none';
  if (mine === 'accepted' && theirs === 'accepted') status = 'allies';
  else if (mine === 'pending') status = 'pending_outgoing';
  else if (theirs === 'pending') status = 'pending_incoming';

  return { status };
}

const DEFAULT_ALLY_PAGE_SIZE = 20;

/**
 * GET /interactions/allies/:userId
 */
export async function listAllies(userId: string, cursor: string | null, limit = DEFAULT_ALLY_PAGE_SIZE): Promise<PaginatedAllyList> {
  const offset = cursor ? Number(cursor) || 0 : 0;
  const items = await interactionModel.listAllies(userId, limit + 1, offset);
  const hasMore = items.length > limit;
  return { items: items.slice(0, limit), nextCursor: hasMore ? String(offset + limit) : null };
}

/**
 * GET /interactions/allies/:userId/count
 */
export async function getAlliesCount(userId: string): Promise<number> {
  return interactionModel.getAlliesCount(userId);
}
