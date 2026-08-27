// src/app/types/matchReveal.types.ts

export interface ConversationInsights {
  totalMessages: number;
  daysActive: number;
}

export interface RevealPartnerView {
  // Stage 2+
  ageRange?: string | null;
  zodiacSign?: string | null;
  personalityType?: string | null;
  musicTaste?: string[];
  movieInterests?: string[];
  studyCategory?: string | null;
  blurredAvatarUrl?: string | null;
  // Stage 3+
  firstNameLetter?: string | null;
  favoriteHobby?: string | null;
  // Stage 4 — the only point any of this becomes identifying
  fullName?: string | null;
  username?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  userId?: string | null;
}

export interface RevealData {
  stage: number;
  stageName: string;
  dayStreak: number;
  // Stage 1+
  compatibilityScore: number | null;
  sharedInterests: string[];
  sharedCategories: string[];
  conversationInsights: ConversationInsights | null;
  icebreakers: string[];
  partner: RevealPartnerView;
}

export interface TimelinePostView {
  id: string;
  content: string;
  mediaUrls: string[];
  likesCount: number;
  commentsCount: number;
  createdAt: string;
}

export interface TimelineData {
  locked: boolean;
  blurred: boolean;
  posts: TimelinePostView[];
}
