import type { StageCapabilities, StageTask } from '../constants/progression';

export interface ConversationInsights {
  totalMessages: number;
  daysActive: number;
}

export interface DailyTaskStatus {
  taskId: string;
  label: string;
  description: string;
  basePoints: number;
  /** Did the current viewer complete this task today? */
  myCompleted: boolean;
  /** Did the partner complete this task today? */
  partnerCompleted: boolean;
  /** Points awarded to viewer for this task today (0 if not completed). */
  myPointsAwarded: number;
}

export interface RevealPartnerView {
  // Stage 2+ (Non-identifying compatibility clues only)
  ageRange?: string | null;
  zodiacSign?: string | null;
  personalityType?: string | null;
  musicTaste?: string[];
  movieInterests?: string[];
  studyCategory?: string | null;
  // Stage 3+
  favoriteHobby?: string | null;
  // Profile Unlocked (250 pts / revealed_at)
  userId?: string | null;
  fullName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  department?: string | null;
  course?: string | null;
}

/** Progressive real-avatar reveal state for the partner (driven by match points). */
export interface AvatarRevealView {
  /** 0 = animal only … 5 = fully revealed. */
  tier: number;
  maxTier: number;
  /** Exact progress 0..1 toward profile unlock (used for in-tier smoothing). */
  progress: number;
  matchPoints: number;
  target: number;
  /** Points at which the current tier started / the next tier begins. */
  tierStart: number;
  tierEnd: number;
  /** Point thresholds for each tier (for ring tick marks). */
  tierThresholds: number[];
  hasPhoto: boolean;
  /** Dominant colour of the real photo (safe hint for tier 0). */
  dominantColor: string | null;
  /** Tier thumbnail data URI (tiers 1–4) or real avatar URL (tier 5). */
  previewUrl: string | null;
}

export interface RevealData {
  stage: number;
  stageName: string;
  dayStreak: number;
  targetStreak: number;
  streakProgressPercent: number;
  capabilities: StageCapabilities;
  // Points progression towards 250pt profile unlock
  matchPoints: number;
  profileUnlockTarget: number;
  pointsToProfileUnlock: number;
  isProfileUnlocked: boolean;
  effectiveMultiplier: number;
  // Backward compatibility
  stagePoints: number;
  pointsToNextStage: number;
  // Stage 1+
  compatibilityScore: number | null;
  sharedInterests: string[];
  sharedCategories: string[];
  conversationInsights: ConversationInsights | null;
  icebreakers: string[];
  // Daily tasks for the current stage (reset 12am PHT)
  dailyTasks: DailyTaskStatus[];
  activeTasks: StageTask[];
  partner: RevealPartnerView;
  avatarReveal: AvatarRevealView;
}

export interface TimelinePostView {
  id: string;
  content: string;
  mediaUrls: string[];
  likesCount: number;
  commentsCount: number;
  createdAt: string;
  /** True when the author identity is not yet revealed (anonymous post). */
  isAnonymous: boolean;
}

export interface TimelineData {
  locked: boolean;
  blurred: boolean;
  posts: TimelinePostView[];
}
