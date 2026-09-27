// src/app/services/matchReveal.service.ts
//
// Single choke point for "what can this user see about their match right
// now" — every field is gated by `match.current_stage`, computed and
// persisted by matchTasks.service.ts (points-based progression).
//
// Stage 4 now means FEED UNLOCK, not identity reveal. Partner identity
// stays anonymous until a mutual reveal happens via interaction flow.

import * as matchModel from '../models/matchmaking.model';
import * as profileModel from '../models/profile.model';
import * as lookupModel from '../models/lookup.model';
import * as feedModel from '../models/feed.model';
import { HttpError } from '../types/auth.types';
import {
  getStageCapabilities,
  stageName,
  getTasksForStage,
  getEffectiveMultiplier,
  POINTS_PER_STAGE,
  TOTAL_POINTS_FOR_PROFILE_UNLOCK,
  calculateStreakProgression,
} from '../constants/progression';
import { phtDateStr } from '../utils/pht';
import type {
  RevealData,
  RevealPartnerView,
  TimelineData,
  TimelinePostView,
  DailyTaskStatus,
} from '../types/matchReveal.types';

async function getParticipantMatch(matchId: string, userId: string) {
  let match = await matchModel.getMatchById(matchId);
  if (!match) {
    match = await matchModel.getMatchByConversationId(matchId);
  }
  if (!match) throw new HttpError('Match not found', 404);
  if (match.user_a_id !== userId && match.user_b_id !== userId) {
    throw new HttpError('You are not part of this match', 403);
  }
  return match;
}

function buildIcebreakers(sharedInterests: string[]): string[] {
  if (sharedInterests.length === 0) {
    return [
      "What's a small thing that made you smile this week?",
      'If your week was a song title, what would it be?',
      "What's something you're low-key excited about right now?",
    ];
  }
  return sharedInterests.slice(0, 3).map((interest) => `You both like ${interest} — what got you into it?`);
}

export async function getReveal(matchId: string, userId: string): Promise<RevealData> {
  const match = await getParticipantMatch(matchId, userId);
  const partnerId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
  const stage = match.current_stage;
  const streakProgression = calculateStreakProgression(match.day_streak);
  const matchPoints = match.match_points ?? 0;
  const isProfileUnlocked = Boolean(match.revealed_at || matchPoints >= TOTAL_POINTS_FOR_PROFILE_UNLOCK);
  const pointsToProfileUnlock = isProfileUnlocked ? 0 : Math.max(0, TOTAL_POINTS_FOR_PROFILE_UNLOCK - matchPoints);
  const capabilities = getStageCapabilities(stage, isProfileUnlocked);
  const effectiveMultiplier = getEffectiveMultiplier(stage, match.day_streak);
  const stagePoints = match.stage_points ?? 0;

  // ── Daily tasks status ─────────────────────────────────────────────────────
  const today = phtDateStr();
  const activeTasks = getTasksForStage(stage);
  let dailyTaskStatuses: DailyTaskStatus[] = [];

  if (stage >= 1) {
    const rawTaskRows = await matchModel.getDailyTaskStatus(matchId, today);

    dailyTaskStatuses = activeTasks.map((task) => {
      const myRow = rawTaskRows.find((r) => r.task_id === task.id && r.user_id === userId);
      const partnerRow = rawTaskRows.find((r) => r.task_id === task.id && r.user_id === partnerId);
      return {
        taskId: task.id,
        label: task.label,
        description: task.description,
        basePoints: task.basePoints,
        myCompleted: !!myRow,
        partnerCompleted: !!partnerRow,
        myPointsAwarded: myRow?.points_awarded ?? 0,
      };
    });
  }

  if (stage < 1) {
    return {
      stage,
      stageName: stageName(stage),
      dayStreak: match.day_streak,
      targetStreak: streakProgression.targetStreak,
      streakProgressPercent: streakProgression.progressPercent,
      capabilities,
      matchPoints,
      profileUnlockTarget: TOTAL_POINTS_FOR_PROFILE_UNLOCK,
      pointsToProfileUnlock,
      isProfileUnlocked,
      effectiveMultiplier,
      stagePoints,
      pointsToNextStage: pointsToProfileUnlock,
      compatibilityScore: null,
      sharedInterests: [],
      sharedCategories: [],
      conversationInsights: null,
      icebreakers: [],
      dailyTasks: [],
      activeTasks,
      partner: {},
    };
  }

  const [me, partner, dailyActivity, allInterests] = await Promise.all([
    profileModel.findById(userId),
    profileModel.findById(partnerId),
    matchModel.getDailyActivity(matchId),
    lookupModel.findAllInterests(),
  ]);

  const myInterests = new Set(me?.interests ?? []);
  const sharedInterests = (partner?.interests ?? []).filter((i) => myInterests.has(i));

  const categoryByName = new Map(allInterests.map((i) => [i.name, i.category]));
  const sharedCategories = [...new Set(sharedInterests.map((i) => categoryByName.get(i)).filter((c): c is string => Boolean(c)))];

  const conversationInsights = {
    totalMessages: dailyActivity.reduce((sum, r) => sum + r.user_a_message_count + r.user_b_message_count, 0),
    daysActive: dailyActivity.length,
  };

  const partnerView: RevealPartnerView = {};

  // Stage 2: Non-identifying compatibility clues (unlocked at 3-day streak)
  if (stage >= 2) {
    partnerView.ageRange = partner?.age_range ?? null;
    partnerView.zodiacSign = partner?.zodiac_sign ?? null;
    partnerView.personalityType = partner?.personality_type ?? null;
    partnerView.musicTaste = partner?.music_taste ?? [];
    partnerView.movieInterests = partner?.movie_interests ?? [];
    partnerView.studyCategory = partner?.department ?? null;
  }

  // Stage 3: Mutual interests/hobbies (unlocked at 7-day streak)
  if (stage >= 3) {
    partnerView.favoriteHobby = partner?.interests?.[0] ?? null;
  }

  // Profile Unlocked: Real identity revealed when 500 points are reached
  if (isProfileUnlocked) {
    partnerView.userId = partner?.id ?? null;
    partnerView.fullName = partner?.full_name ?? null;
    partnerView.username = partner?.username ?? null;
    partnerView.avatarUrl = partner?.avatar_url ?? null;
    partnerView.bio = partner?.bio ?? null;
    partnerView.department = partner?.department ?? null;
    partnerView.course = partner?.course ?? null;
  }

  return {
    stage,
    stageName: stageName(stage),
    dayStreak: match.day_streak,
    targetStreak: streakProgression.targetStreak,
    streakProgressPercent: streakProgression.progressPercent,
    capabilities,
    matchPoints,
    profileUnlockTarget: TOTAL_POINTS_FOR_PROFILE_UNLOCK,
    pointsToProfileUnlock,
    isProfileUnlocked,
    effectiveMultiplier,
    stagePoints,
    pointsToNextStage: pointsToProfileUnlock,
    compatibilityScore: match.compatibility_score,
    sharedInterests,
    sharedCategories,
    conversationInsights,
    icebreakers: buildIcebreakers(sharedInterests),
    dailyTasks: dailyTaskStatuses,
    activeTasks,
    partner: partnerView,
  };
}

export async function getTimeline(matchId: string, userId: string): Promise<TimelineData> {
  const match = await getParticipantMatch(matchId, userId);
  const partnerId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
  const stage = match.current_stage;

  // Timeline (partner's feed posts) is only accessible from Stage 4 onward.
  // Posts are shown but remain ANONYMOUS (no real name/avatar) until the
  // partner's identity is explicitly revealed through the interaction flow.
  if (stage < 4) {
    return { locked: true, blurred: false, posts: [] };
  }

  const posts = await feedModel.findPostsByAuthor(partnerId, 12);
  const viewable = await Promise.all(posts.map((p) => feedModel.canViewPost(userId, partnerId, p.audience)));
  const visiblePosts = posts.filter((_, i) => viewable[i]);
  const mediaByPost = await feedModel.findMediaForPosts(visiblePosts.map((p) => p.id));

  const postViews: TimelinePostView[] = visiblePosts.map((p) => ({
    id: p.id,
    content: p.content,
    mediaUrls: (mediaByPost.get(p.id) ?? []).map((m) => m.url),
    likesCount: p.likes_count,
    commentsCount: p.comments_count,
    createdAt: p.created_at,
    // Always anonymous in the timeline until the partner explicitly reveals their identity.
    isAnonymous: true,
  }));

  return { locked: false, blurred: false, posts: postViews };
}
