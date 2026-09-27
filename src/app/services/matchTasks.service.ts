// src/app/services/matchTasks.service.ts
//
// Handles daily task tracking and point awarding for match progression.
//
// ── Task lifecycle ────────────────────────────────────────────────────────────
//
//   1. A task is TRIGGERED by an action (message sent, game completed, photo sent).
//   2. completeTask() checks if the task is available for this stage.
//   3. If not already completed today (per match_daily_tasks), it awards points.
//   4. Points are scaled by the effective multiplier (stage base + streak bonus).
//   5. After awarding, recomputePointsProgression() checks if stage_points >= 500.
//   6. If yes, the stage advances (and stage_points resets to 0).
//   7. Stage 4 advancement triggers feed unlock + ally relationship creation.
//
// ── Task IDs ─────────────────────────────────────────────────────────────────
//   'send_message'  — called from conversation.service after a message send
//   'play_game'     — called from game session service (when ≥ 5 min elapsed)
//   'send_photo'    — called from conversation.service after a media upload
//
// ── Task reset ────────────────────────────────────────────────────────────────
//   Tasks reset per PHT calendar date. The task_date stored in the DB is the
//   PHT date string (YYYY-MM-DD, UTC+8). Comparing today's PHT date against
//   the stored date is the only "reset" logic needed — nothing to schedule.

import { phtDateStr } from '../utils/pht';
import * as matchModel from '../models/matchmaking.model';
import * as interactionModel from '../models/interaction.model';
import * as conversationModel from '../models/conversation.model';
import { emitToUser } from './realtime.service';
import {
  POINTS_PER_STAGE,
  TOTAL_POINTS_FOR_PROFILE_UNLOCK,
  getTasksForStage,
  getEffectiveMultiplier,
  stageName,
} from '../constants/progression';
import { upgradeConversationToAllied } from '../models/conversation.model';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Records a task completion for a user in a match and awards points.
 * Safe to call multiple times per day — idempotent (only awards once per task/day).
 *
 * @param matchId     - The match UUID
 * @param userId      - The user completing the task
 * @param taskId      - One of: 'send_message' | 'play_game' | 'send_photo'
 * @returns pointsAwarded (0 = already completed or task not active for this stage)
 */
export async function completeTask(
  matchId: string,
  userId: string,
  taskId: string,
): Promise<{ pointsAwarded: number; newStagePoints: number; stageAdvanced: boolean }> {
  const match = await matchModel.getMatchById(matchId);
  if (!match || match.status === 'ended' || match.status === 'expired') {
    return { pointsAwarded: 0, newStagePoints: match?.stage_points ?? 0, stageAdvanced: false };
  }

  const stage = match.current_stage;

  // Check if this task is available at the current stage
  const availableTasks = getTasksForStage(stage);
  const task = availableTasks.find((t) => t.id === taskId);
  if (!task) {
    return { pointsAwarded: 0, newStagePoints: match.stage_points, stageAdvanced: false };
  }

  const today = phtDateStr();
  const multiplier = getEffectiveMultiplier(stage, match.day_streak);

  const result = await matchModel.awardTaskPoints(
    matchId,
    userId,
    taskId,
    today,
    task.basePoints,
    multiplier,
  );

  if (result.pointsAwarded > 0) {
    // Broadcast points update to both participants
    const payload = {
      matchId,
      taskId,
      pointsAwarded: result.pointsAwarded,
      stagePoints: result.newStagePoints,
      matchPoints: result.newMatchPoints,
      stage,
    };
    emitToUser(match.user_a_id, 'match:points_updated', payload);
    emitToUser(match.user_b_id, 'match:points_updated', payload);
  }

  // Check if profile should unlock (reaches 500 total points)
  let profileUnlocked = false;
  if (result.newMatchPoints >= TOTAL_POINTS_FOR_PROFILE_UNLOCK && !match.revealed_at) {
    profileUnlocked = true;
    await unlockProfile(match);
  }

  return {
    pointsAwarded: result.pointsAwarded,
    newStagePoints: result.newStagePoints,
    stageAdvanced: profileUnlocked,
  };
}

/**
 * Automatically unlocks profiles and identities when 500 points are reached.
 */
async function unlockProfile(match: import('../types/matchmaking.types').MatchRow): Promise<void> {
  await matchModel.revealMatch(match.id).catch(() => {});

  const payload = {
    matchId: match.id,
    conversationId: match.conversation_id,
    profileUnlocked: true,
    revealed: true,
  };
  emitToUser(match.user_a_id, 'matchmaking:profile_unlocked', payload);
  emitToUser(match.user_b_id, 'matchmaking:profile_unlocked', payload);
  emitToUser(match.user_a_id, 'matchmaking:revealed', payload);
  emitToUser(match.user_b_id, 'matchmaking:revealed', payload);

  await Promise.all([
    interactionModel.createNotification({
      userId: match.user_a_id,
      type: 'accepted',
      title: '🎉 Real Identities Revealed!',
      description:
        'You reached 500 points together! Real names, avatars, and full profiles are now unlocked.',
      fromUserId: match.user_b_id,
      targetId: match.conversation_id ?? undefined,
    }),
    interactionModel.createNotification({
      userId: match.user_b_id,
      type: 'accepted',
      title: '🎉 Real Identities Revealed!',
      description:
        'You reached 500 points together! Real names, avatars, and full profiles are now unlocked.',
      fromUserId: match.user_a_id,
      targetId: match.conversation_id ?? undefined,
    }),
  ]).catch(() => {});
}

/**
 * Called from conversation.service after a message is sent in an anonymous match.
 * Triggers the 'send_message' task for the sender.
 */
export async function onMatchMessageSent(matchId: string, senderId: string): Promise<void> {
  await completeTask(matchId, senderId, 'send_message').catch((err) =>
    console.error('[matchTasks] onMatchMessageSent error:', err),
  );
}

/**
 * Called from the game session service when a joint game session ≥ 5 minutes completes.
 * Triggers the 'play_game' task for the user.
 */
export async function onGameSessionCompleted(matchId: string, userId: string): Promise<void> {
  await completeTask(matchId, userId, 'play_game').catch((err) =>
    console.error('[matchTasks] onGameSessionCompleted error:', err),
  );
}

/**
 * Called from conversation.service after a media/photo upload in an anonymous match.
 * Triggers the 'send_photo' task for the sender.
 */
export async function onMatchPhotoSent(matchId: string, senderId: string): Promise<void> {
  await completeTask(matchId, senderId, 'send_photo').catch((err) =>
    console.error('[matchTasks] onMatchPhotoSent error:', err),
  );
}
