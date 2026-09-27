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
  // Profile Unlocked (500 pts / revealed_at)
  userId?: string | null;
  fullName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  department?: string | null;
  course?: string | null;
}

export interface RevealData {
  stage: number;
  stageName: string;
  dayStreak: number;
  targetStreak: number;
  streakProgressPercent: number;
  capabilities: StageCapabilities;
  // Points progression towards 500pt profile unlock
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
