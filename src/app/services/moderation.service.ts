// src/services/moderation.service.ts
import * as moderationModel from '../models/moderation.model';
import { HttpError } from '../types/auth.types';
import type {
  BlockUserResult,
  ReportRow,
  ReportUserPayload,
  UnblockUserResult,
  BlockedUserRow,
  RestrictUserResult,
  UnrestrictUserResult,
  RestrictedUserRow,
  MuteUserResult,
  UnmuteUserResult,
  MutedUserRow,
} from '../types/moderation.types';

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

  try {
    const { recordActivity } = await import('./activityLog.service');
    recordActivity({
      userId: currentUserId,
      bucket: 'safety',
      action: 'safety:user_blocked',
      title: 'Blocked a user',
      targetType: 'profile',
      targetId: blockedUserId,
    });
  } catch {}

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
    postId: payload.postId ?? null,
    messageId: payload.messageId ?? null,
    notes: payload.notes ?? null,
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

  try {
    const { recordActivity } = await import('./activityLog.service');
    recordActivity({
      userId: currentUserId,
      bucket: 'safety',
      action: 'safety:user_unblocked',
      title: 'Unblocked a user',
      targetType: 'profile',
      targetId: blockedUserId,
    });
  } catch {}

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

// ─────────────────────────────────────────────────────────────────────────────
// Restrict Services (Mutual presence removal)
// ─────────────────────────────────────────────────────────────────────────────

export async function restrictUser(currentUserId: string, restrictedUserId: string): Promise<RestrictUserResult> {
  if (currentUserId === restrictedUserId) {
    throw new HttpError('You cannot restrict yourself', 400);
  }

  const row = await moderationModel.createRestriction(currentUserId, restrictedUserId);

  try {
    const { recordActivity } = await import('./activityLog.service');
    recordActivity({
      userId: currentUserId,
      bucket: 'safety',
      action: 'safety:user_restricted',
      title: 'Restricted a user',
      targetType: 'profile',
      targetId: restrictedUserId,
    });
  } catch {}

  return { success: true, restrictedAt: row.created_at };
}

export async function unrestrictUser(currentUserId: string, restrictedUserId: string): Promise<UnrestrictUserResult> {
  await moderationModel.deleteRestriction(currentUserId, restrictedUserId);

  try {
    const { recordActivity } = await import('./activityLog.service');
    recordActivity({
      userId: currentUserId,
      bucket: 'safety',
      action: 'safety:user_unrestricted',
      title: 'Unrestricted a user',
      targetType: 'profile',
      targetId: restrictedUserId,
    });
  } catch {}

  return { success: true };
}

export async function checkIsRestricted(currentUserId: string, otherUserId: string): Promise<{ restricted: boolean; restrictedByMe: boolean }> {
  const [restricted, restrictedByMe] = await Promise.all([
    moderationModel.isRestricted(currentUserId, otherUserId),
    moderationModel.isRestrictedBy(currentUserId, otherUserId),
  ]);
  return { restricted, restrictedByMe };
}

export async function listRestrictedUsers(userId: string): Promise<RestrictedUserRow[]> {
  const rows = await moderationModel.findRestrictedUsersWithProfiles(userId);

  return rows.map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: (profile?.id as string | undefined) ?? (row.restricted_id as string),
      fullName: (profile?.full_name as string | null | undefined) ?? null,
      username: (profile?.username as string | null | undefined) ?? null,
      avatarUrl: (profile?.avatar_url as string | null | undefined) ?? null,
      restrictedAt: row.created_at as string,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mute Services (Notification suppression)
// ─────────────────────────────────────────────────────────────────────────────

export async function muteUser(currentUserId: string, mutedUserId: string): Promise<MuteUserResult> {
  if (currentUserId === mutedUserId) {
    throw new HttpError('You cannot mute yourself', 400);
  }

  const row = await moderationModel.createMute(currentUserId, mutedUserId);

  try {
    const { recordActivity } = await import('./activityLog.service');
    recordActivity({
      userId: currentUserId,
      bucket: 'safety',
      action: 'safety:user_muted',
      title: 'Muted a user',
      targetType: 'profile',
      targetId: mutedUserId,
    });
  } catch {}

  return { success: true, mutedAt: row.created_at };
}

export async function unmuteUser(currentUserId: string, mutedUserId: string): Promise<UnmuteUserResult> {
  await moderationModel.deleteMute(currentUserId, mutedUserId);

  try {
    const { recordActivity } = await import('./activityLog.service');
    recordActivity({
      userId: currentUserId,
      bucket: 'safety',
      action: 'safety:user_unmuted',
      title: 'Unmuted a user',
      targetType: 'profile',
      targetId: mutedUserId,
    });
  } catch {}

  return { success: true };
}

export async function checkIsMuted(currentUserId: string, otherUserId: string): Promise<{ muted: boolean }> {
  const muted = await moderationModel.isMuted(currentUserId, otherUserId);
  return { muted };
}

export async function listMutedUsers(userId: string): Promise<MutedUserRow[]> {
  const rows = await moderationModel.findMutedUsersWithProfiles(userId);

  return rows.map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: (profile?.id as string | undefined) ?? (row.muted_id as string),
      fullName: (profile?.full_name as string | null | undefined) ?? null,
      username: (profile?.username as string | null | undefined) ?? null,
      avatarUrl: (profile?.avatar_url as string | null | undefined) ?? null,
      mutedAt: row.created_at as string,
    };
  });
}