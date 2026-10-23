// src/app/services/adminSeeder.service.ts

import * as adminSeederModel from '../models/adminSeeder.model';
import * as adminModel from '../models/admin.model';
import { emitToUser } from './realtime.service';
import { HttpError } from '../types/auth.types';
import { stageName, TOTAL_POINTS_FOR_PROFILE_UNLOCK } from '../constants/progression';
import type { SeederConversationItem, SeedPointsPayload, SeedPointsResult } from '../types/adminSeeder.types';

export async function listConversations(limit = 50): Promise<SeederConversationItem[]> {
  return await adminSeederModel.listRecentConversations(limit);
}

export async function seedConversationPoints(
  adminId: string,
  payload: SeedPointsPayload,
  ip?: string,
): Promise<SeedPointsResult> {
  const { conversationId, points } = payload;

  if (!conversationId || typeof conversationId !== 'string') {
    throw new HttpError('Valid conversation ID is required', 400);
  }

  if (typeof points !== 'number' || isNaN(points) || points < 0 || points > 10000) {
    throw new HttpError('Points must be a valid number between 0 and 10000', 400);
  }

  // 1. Verify conversation exists
  const conversation = await adminSeederModel.findConversationById(conversationId);
  if (!conversation) {
    throw new HttpError('Conversation not found', 404);
  }

  // 2. Fetch or create match row
  let match = await adminSeederModel.findMatchByConversationId(conversationId);
  const memberIds = await adminSeederModel.findConversationMembers(conversationId);

  if (!match) {
    if (memberIds.length < 2) {
      throw new HttpError('Conversation must have at least 2 members to seed match points', 400);
    }
    match = await adminSeederModel.createMatch({
      conversation_id: conversationId,
      user_a_id: memberIds[0],
      user_b_id: memberIds[1],
      match_points: 0,
      stage_points: 0,
      current_stage: 1,
      day_streak: 0,
      revealed_at: null,
      status: 'active',
    });
  }

  if (!match) {
    throw new HttpError('Failed to initialize match for conversation', 500);
  }

  const prevPoints: number = match.match_points ?? 0;
  const prevStage: number = match.current_stage ?? 1;

  // 3. Compute progressive stage & streak
  let newStage = 1;
  let newStreak: number = match.day_streak ?? 0;

  if (points >= 225) {
    newStage = 4;
    if (newStreak < 10) newStreak = 10;
  } else if (points >= 150) {
    newStage = 3;
    if (newStreak < 7) newStreak = 7;
  } else if (points >= 75) {
    newStage = 2;
    if (newStreak < 3) newStreak = 3;
  }

  const isRevealed = points >= TOTAL_POINTS_FOR_PROFILE_UNLOCK;
  const revealedAt = isRevealed ? (match.revealed_at || new Date().toISOString()) : null;

  // 4. Update database
  const updatedMatch = await adminSeederModel.updateMatchPoints(match.id, {
    match_points: points,
    stage_points: points % 75,
    current_stage: newStage,
    day_streak: newStreak,
    revealed_at: revealedAt,
  });

  // 5. Broadcast realtime events to participants
  const participants = [match.user_a_id, match.user_b_id].filter(Boolean) as string[];
  const pointsPayload = {
    conversationId,
    matchId: match.id,
    matchPoints: points,
    currentStage: newStage,
    dayStreak: newStreak,
    isRevealed,
  };

  const stagePayload = {
    matchId: match.id,
    conversationId,
    stage: newStage,
    previousStage: prevStage,
    stageName: stageName(newStage),
    dayStreak: newStreak,
    downgraded: newStage < prevStage,
  };

  participants.forEach((userId: string) => {
    emitToUser(userId, 'match:points_updated', pointsPayload);
    emitToUser(userId, 'matchmaking:stage_updated', stagePayload);
  });

  // 6. Security audit trail logging
  await adminModel.logAction({
    adminId,
    action: 'seed_conversation_points',
    targetUserId: null,
    metadata: {
      conversationId,
      matchId: match.id,
      previousPoints: prevPoints,
      newPoints: points,
      previousStage: prevStage,
      newStage,
      newStreak,
      isRevealed,
    },
    ipAddress: ip,
  });

  return {
    conversationId,
    matchId: match.id,
    previousPoints: prevPoints,
    newPoints: points,
    currentStage: newStage,
    dayStreak: newStreak,
    revealedAt: updatedMatch.revealed_at ?? null,
    isRevealed,
  };
}
