import * as interactionModel from '../models/interaction.model';
import * as notificationModel from '../models/notification.model';
import * as matchModel from '../models/matchmaking.model';
import * as matchmakingService from './matchmaking.service';
import { emitToUser } from './realtime.service';
import { HttpError } from '../types/auth.types';
import type {
  AcceptConnectionResponse,
  AllyFilterOptions,
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
  const [interactionRows, activeMatches] = await Promise.all([
    interactionModel.findAllByUser(userId),
    matchModel.getActiveMatchesForUser(userId),
  ]);

  const partnerIds = new Set(interactionRows.map((r) => r.target_user_id));
  const result: InteractionRow[] = [...interactionRows];

  for (const match of activeMatches) {
    const partnerId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
    if (partnerIds.has(partnerId)) continue;

    // Determine if match is pending acceptance or already accepted
    let status: 'pending' | 'accepted' = 'accepted';
    if (match.user_a_id === userId) {
      // User A requested User B. If User B has an unhandled friend_request notification, it's pending.
      const isPending = await notificationModel.hasPendingFriendRequest(match.user_b_id, userId).catch(() => false);
      if (isPending) status = 'pending';
    } else if (match.user_b_id === userId) {
      // User B received request from User A. If User B has unhandled friend_request, it's pending.
      const isPending = await notificationModel.hasPendingFriendRequest(userId, match.user_a_id).catch(() => false);
      if (isPending) status = 'pending';
    }

    result.push({
      user_id: userId,
      target_user_id: partnerId,
      status,
      accepted_at: status === 'accepted' ? (match.confirmed_at || match.created_at) : null,
    });
    partnerIds.add(partnerId);
  }

  return result;
}

/**
 * POST /interactions/incoming
 */
export async function listIncoming(targetUserId: string, requesterIds: string[]): Promise<InteractionRow[]> {
  return interactionModel.findIncomingFromRequesters(targetUserId, requesterIds);
}

/**
 * POST /interactions/request
 * Initiates an anonymous match request at Stage 1. Users must progress
 * through the 4-stage roadmap before becoming official allies.
 */
export async function requestConnection(userId: string, targetUserId: string): Promise<void> {
  if (userId === targetUserId) {
    throw new HttpError('Cannot send a connection request to yourself', 409);
  }

  await matchmakingService.requestDirectMatch(userId, targetUserId);
}

/**
 * POST /interactions/accept
 * Accepts a match invitation and opens an anonymous Stage 1 chat.
 *
 * SECURITY: Does NOT grant ally status or reveal identities here.
 * Accepting only starts the anonymous roadmap at Stage 1.
 * Real identities are revealed automatically when Stage 4 is completed
 * via matchmaking.service.ts#recomputeProgression.
 */
export async function acceptConnection(
  currentUserId: string,
  requesterId: string
): Promise<AcceptConnectionResponse> {
  // Start (or resume) the anonymous match — always Stage 1, always anonymous.
  const result = await matchmakingService.requestDirectMatch(currentUserId, requesterId);

  // Remove the friend_request notification for the current user once handled.
  await notificationModel.deleteFriendRequestNotification(currentUserId, requesterId).catch((err) => {
    console.warn('Failed to delete handled friend_request notification:', err);
  });

  // Notify the requester that their request was accepted and the anonymous
  // chat is ready — use a neutral message that does not reveal identity.
  await interactionModel.createNotification({
    userId: requesterId,
    type: 'connection_accepted',
    title: 'Match Request Accepted!',
    description: 'Your match request was accepted! Start your anonymous chat to begin the Ally Roadmap.',
    fromUserId: null as any, // deliberately null — do NOT expose acceptor identity
    targetId: result.conversationId,
  }).catch((err) => {
    console.warn('Failed to notify requester of accepted match:', err);
  });

  // Emit realtime event to the requester so their UI opens the anonymous chat.
  // fromUserId is intentionally omitted to avoid client-side identity leaks.
  emitToUser(requesterId, 'matchmaking:match_accepted', {
    conversationId: result.conversationId,
  });

  return { conversationId: result.conversationId };
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

  // Remove the friend_request notification once declined/rejected
  await notificationModel.deleteFriendRequestNotification(userId, targetUserId).catch((err) => {
    console.warn('Failed to delete declined friend_request notification:', err);
  });

  // End active match between them if any
  const existingMatch = await matchModel.findActiveMatchBetweenUsers(userId, targetUserId).catch(() => null);
  if (existingMatch) {
    await matchmakingService.endMatch(existingMatch.id, userId).catch((err) => {
      console.warn('Failed to end match on rejection:', err);
    });
  }
}

/**
 * GET /interactions/status/:targetUserId
 */
export async function getConnectionStatus(
  userId: string,
  targetUserId: string
): Promise<ConnectionStatusResponse> {
  let status = await interactionModel.findStatus(userId, targetUserId);
  if (!status) {
    const activeMatch = await matchModel.findActiveMatchBetweenUsers(userId, targetUserId).catch(() => null);
    if (activeMatch) {
      const targetHasReq = await notificationModel.hasPendingFriendRequest(targetUserId, userId).catch(() => false);
      status = targetHasReq ? 'pending' : 'accepted';
    }
  }
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
  if (mine === 'accepted' && theirs === 'accepted') {
    status = 'allies';
  } else if (mine === 'pending') {
    status = 'pending_outgoing';
  } else if (theirs === 'pending') {
    status = 'pending_incoming';
  } else {
    // Check active match from matchmaking
    const activeMatch = await matchModel.findActiveMatchBetweenUsers(userId, targetUserId).catch(() => null);
    if (activeMatch) {
      if (activeMatch.revealed_at) {
        status = 'allies';
      } else {
        const [targetHasReq, userHasReq] = await Promise.all([
          notificationModel.hasPendingFriendRequest(targetUserId, userId).catch(() => false),
          notificationModel.hasPendingFriendRequest(userId, targetUserId).catch(() => false),
        ]);

        if (targetHasReq) {
          status = 'pending_outgoing';
        } else if (userHasReq) {
          status = 'pending_incoming';
        } else {
          // Both sides accepted! Active match in progress
          status = 'allies';
        }
      }
    }
  }

  return { status };
}

const DEFAULT_ALLY_PAGE_SIZE = 20;

/**
 * GET /interactions/allies/:userId
 */
export async function listAllies(
  userId: string,
  cursor: string | null,
  limit = DEFAULT_ALLY_PAGE_SIZE,
  filters?: AllyFilterOptions
): Promise<PaginatedAllyList> {
  const offset = cursor ? Number(cursor) || 0 : 0;
  const items = await interactionModel.listAllies(userId, limit + 1, offset, filters);
  const hasMore = items.length > limit;
  return { items: items.slice(0, limit), nextCursor: hasMore ? String(offset + limit) : null };
}

/**
 * GET /interactions/allies/:userId/count
 */
export async function getAlliesCount(userId: string): Promise<number> {
  return interactionModel.getAlliesCount(userId);
}
