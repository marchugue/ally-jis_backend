// src/app/constants/progression.ts
//
// Dual Streak & Points Progression Architecture:
//
//   1. STAGES ARE STREAK-BASED:
//      • Stage 1: 0 days streak  (1x multiplier)  → Anonymous Chat & Icebreakers
//      • Stage 2: 3 days streak  (2x multiplier)  → Games unlocked, age/zodiac clues
//      • Stage 3: 7 days streak  (3x multiplier)  → Photo sharing in chat, hobby clue
//      • Stage 4: 10 days streak (4x multiplier)  → Campus Allies Feed Unlock (Anonymous)
//
//   2. PROFILE UNLOCK IS POINTS-BASED:
//      • 500 total match points required to unlock real profile / identity reveal.
//      • Points are earned via daily tasks (reset at 12:00 AM PHT).
//      • Higher stages increase the multiplier (1x → 2x → 3x → 4x), accelerating
//        points accumulation towards the 500 pts profile unlock!
//
//   3. DAILY TASKS (max 5 tasks total, additive per stage, reset at 12 AM PHT):
//      • Stage 1+: send_message  (1 pt × multiplier)
//      • Stage 2+: play_game     (2 pts × multiplier)
//      • Stage 3+: send_photo    (3 pts × multiplier)
//      • Stage 4+: all tasks remain active towards 500 pts

/** Consecutive daily streak required to enter each stage. */
export const STAGE_THRESHOLDS = [0, 0, 3, 7, 10] as const;

/** Total match points needed to unlock real profile / identity reveal. */
export const TOTAL_POINTS_FOR_PROFILE_UNLOCK = 500;

/** Backward-compat alias */
export const POINTS_PER_STAGE = 500;

/** Multiplier per stage. */
export const STAGE_BASE_MULTIPLIER: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
};

/** A day counts toward the streak when BOTH members have sent at least 1 message that PHT day. */
export const MIN_MESSAGES_PER_VALID_DAY = 1;

export const STAGE_NAMES = [
  'Stranger',           // Stage 0
  'Anonymous Chat',     // Stage 1 (0d)
  'Play Together',      // Stage 2 (3d)
  'Media Sharing',      // Stage 3 (7d)
  'Campus Allies',      // Stage 4 (10d — Feed Unlocked, still anonymous)
] as const;

// ── Task definitions ─────────────────────────────────────────────────────────

export interface StageTask {
  id: string;
  label: string;
  description: string;
  basePoints: number;
  unlockedAtStage: number;
}

export const ALL_STAGE_TASKS: StageTask[] = [
  {
    id: 'send_message',
    label: 'Send a message',
    description: 'Both of you send at least 1 message today',
    basePoints: 1,
    unlockedAtStage: 1,
  },
  {
    id: 'play_game',
    label: 'Play a game together',
    description: 'Play a campus mini-game together for at least 5 minutes',
    basePoints: 2,
    unlockedAtStage: 2,
  },
  {
    id: 'send_photo',
    label: 'Share a photo',
    description: 'Each of you share at least 1 photo in chat',
    basePoints: 3,
    unlockedAtStage: 3,
  },
];

export function getTasksForStage(stage: number): StageTask[] {
  return ALL_STAGE_TASKS.filter((t) => t.unlockedAtStage <= stage);
}

/** Effective multiplier for task rewards based on stage. */
export function getEffectiveMultiplier(stage: number, _dayStreak: number = 0): number {
  return STAGE_BASE_MULTIPLIER[stage] ?? 1;
}

// ── Stage capabilities ────────────────────────────────────────────────────────

export interface StageCapabilities {
  stage: number;
  stageName: string;
  canChat: boolean;
  canPlayGames: boolean;
  canUploadImages: boolean;
  /** Stage 4: feed of both users appears in "Allies" newsfeed filter (anonymous). */
  feedUnlocked: boolean;
  isAllies: boolean;
  /** Identity reveal happens at 500 points (or manual mutual reveal). */
  isRevealed: boolean;
}

export function getStageCapabilities(stage: number, isRevealed: boolean = false): StageCapabilities {
  return {
    stage,
    stageName: stageName(stage),
    canChat: stage >= 1,
    canPlayGames: stage >= 2,
    canUploadImages: stage >= 3,
    feedUnlocked: stage >= 4,
    isAllies: stage >= 4,
    isRevealed,
  };
}

/**
 * Returns the stage corresponding to a given day streak (3d, 7d, 10d).
 */
export function stageForStreak(days: number): number {
  if (days >= 10) return 4;
  if (days >= 7) return 3;
  if (days >= 3) return 2;
  return 1;
}

export function stageName(stage: number): string {
  return STAGE_NAMES[stage] ?? STAGE_NAMES[1];
}

export interface StreakProgression {
  currentStage: number;
  targetStage: number;
  currentStreak: number;
  targetStreak: number;
  stageStartStreak: number;
  progressPercent: number;
  isMaxStage: boolean;
  stageLabel: string;
  targetLabel: string;
}

export function calculateStreakProgression(dayStreak: number = 0): StreakProgression {
  if (dayStreak >= 10) {
    return {
      currentStage: 4,
      targetStage: 4,
      currentStreak: dayStreak,
      targetStreak: 10,
      stageStartStreak: 10,
      progressPercent: 100,
      isMaxStage: true,
      stageLabel: 'Lv.4',
      targetLabel: 'MAX',
    };
  }

  if (dayStreak >= 7) {
    const range = 10 - 7;
    const progressPercent = Math.max(0, Math.min(100, Math.round(((dayStreak - 7) / range) * 100)));
    return {
      currentStage: 3,
      targetStage: 4,
      currentStreak: dayStreak,
      targetStreak: 10,
      stageStartStreak: 7,
      progressPercent,
      isMaxStage: false,
      stageLabel: 'Lv.3',
      targetLabel: 'Lv.4',
    };
  }

  if (dayStreak >= 3) {
    const range = 7 - 3;
    const progressPercent = Math.max(0, Math.min(100, Math.round(((dayStreak - 3) / range) * 100)));
    return {
      currentStage: 2,
      targetStage: 3,
      currentStreak: dayStreak,
      targetStreak: 7,
      stageStartStreak: 3,
      progressPercent,
      isMaxStage: false,
      stageLabel: 'Lv.2',
      targetLabel: 'Lv.3',
    };
  }

  const targetStreak = 3;
  const progressPercent = Math.max(0, Math.min(100, Math.round((dayStreak / targetStreak) * 100)));
  return {
    currentStage: 1,
    targetStage: 2,
    currentStreak: dayStreak,
    targetStreak: 3,
    stageStartStreak: 0,
    progressPercent,
    isMaxStage: false,
    stageLabel: 'Lv.1',
    targetLabel: 'Lv.2',
  };
}
