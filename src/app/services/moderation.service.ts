// src/services/moderation.service.ts
import * as moderationModel from '../models/moderation.model';
import { HttpError } from '../types/auth.types';
import type { BlockUserResult, ReportRow, ReportUserPayload, UnblockUserResult, BlockedUserRow } from '../types/moderation.types';

/**
 * Block a user: insert the block row, then strip any existing connection
 * between the two users.
 *
 * Note: two independent Supabase calls, not one transaction (Supabase JS
 * has no cross-call transaction support like PoolClient did). If a block
 * must not persist without the interaction cleanup also succeeding, wrap
 * both steps in a Postgres RPC function and call that instead.
 */
export async function blockUser(currentUserId: string, blockedUserId: string): Promise<BlockUserResult> {
  if (currentUserId === blockedUserId) {
    throw new HttpError('You cannot block yourself', 400);
  }

  const block = await moderationModel.createBlock(currentUserId, blockedUserId);
  await moderationModel.deleteInteractionsBetween(currentUserId, blockedUserId);

  return { success: true, blockedAt: block.created_at };
}

/**
 * Submit a report. Pass-through to the model — no cross-table side
 * effects here (unlike blockUser).
 */
export async function createReport(reporterId: string, payload: ReportUserPayload): Promise<ReportRow> {
  return moderationModel.createReport({
    reporterId,
    reportedUserId: payload.reportedUserId,
    violationId: payload.violationId,
    conversationId: payload.conversationId ?? null,
  });
}

export async function checkIsBlocked(userId: string, otherUserId: string): Promise<boolean> {
  return moderationModel.isBlocked(userId, otherUserId);
}

/**
 * DELETE /moderation/block/:userId
 */
export async function unblockUser(currentUserId: string, blockedUserId: string): Promise<UnblockUserResult> {
  await moderationModel.deleteBlock(currentUserId, blockedUserId);
  return { success: true };
}

/**
 * GET /moderation/blocked
 */
export async function listBlockedUsers(userId: string): Promise<BlockedUserRow[]> {
  const rows = await moderationModel.findBlockedUsersWithProfiles(userId);

  return rows.map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: (profile?.id as string | undefined) ?? (row.blocked_id as string),
      fullName: (profile?.full_name as string | null | undefined) ?? null,
      username: (profile?.username as string | null | undefined) ?? null,
      avatarUrl: (profile?.avatar_url as string | null | undefined) ?? null,
      blockedAt: row.created_at as string,
    };
  });
}