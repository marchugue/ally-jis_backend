// src/app/services/matchReveal.service.ts
//
// Single choke point for "what can this user see about their match right
// now" — every field is gated by `match.current_stage`, computed and
// persisted by matchmaking.service.ts#recomputeProgression. Nothing here
// reads a partner field the caller's stage doesn't clear for.

import * as matchModel from '../models/matchmaking.model';
import * as profileModel from '../models/profile.model';
import * as lookupModel from '../models/lookup.model';
import * as feedModel from '../models/feed.model';
import { HttpError } from '../types/auth.types';
import { stageName } from '../constants/progression';
import type { RevealData, RevealPartnerView, TimelineData, TimelinePostView } from '../types/matchReveal.types';

async function getParticipantMatch(matchId: string, userId: string) {
  const match = await matchModel.getMatchById(matchId);
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

  if (stage < 1) {
    return {
      stage,
      stageName: stageName(stage),
      dayStreak: match.day_streak,
      compatibilityScore: null,
      sharedInterests: [],
      sharedCategories: [],
      conversationInsights: null,
      icebreakers: [],
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

  if (stage >= 2) {
    partnerView.ageRange = partner?.age_range ?? null;
    partnerView.zodiacSign = partner?.zodiac_sign ?? null;
    partnerView.personalityType = partner?.personality_type ?? null;
    partnerView.musicTaste = partner?.music_taste ?? [];
    partnerView.movieInterests = partner?.movie_interests ?? [];
    partnerView.studyCategory = partner?.department ?? null;
    partnerView.blurredAvatarUrl = partner?.avatar_url ?? null;
  }

  if (stage >= 3) {
    const nameSource = partner?.full_name || partner?.username || '';
    partnerView.firstNameLetter = nameSource ? nameSource[0].toUpperCase() : null;
    partnerView.favoriteHobby = partner?.interests?.[0] ?? null;
  }

  if (stage >= 4) {
    partnerView.fullName = partner?.full_name ?? null;
    partnerView.username = partner?.username ?? null;
    partnerView.bio = partner?.bio ?? null;
    partnerView.avatarUrl = partner?.avatar_url ?? null;
    partnerView.userId = partnerId;
  }

  return {
    stage,
    stageName: stageName(stage),
    dayStreak: match.day_streak,
    compatibilityScore: match.compatibility_score,
    sharedInterests,
    sharedCategories,
    conversationInsights,
    icebreakers: buildIcebreakers(sharedInterests),
    partner: partnerView,
  };
}

export async function getTimeline(matchId: string, userId: string): Promise<TimelineData> {
  const match = await getParticipantMatch(matchId, userId);
  const partnerId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
  const stage = match.current_stage;

  if (stage < 3) {
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
  }));

  return { locked: false, blurred: stage === 3, posts: postViews };
}
