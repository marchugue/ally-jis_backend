// src/app/constants/progression.ts

/** A day counts toward the streak when BOTH members have sent at least
 * 1 message that PHT calendar day (12:00 AM → 11:59:59 PM).
 * A single exchange is enough — the streak rewards showing up, not volume. */
export const MIN_MESSAGES_PER_VALID_DAY = 1;

export const STAGE_NAMES = [
  'Stranger',              // Stage 0 (Reserved / Handshake)
  'Anonymous Chat',       // Stage 1 (Text, Icebreakers, Reactions)
  'Play Games Together', // Stage 2 (Can Play Games - Flagged To-Do/Soon)
  'Image Sharing',       // Stage 3 (Can Upload Images)
  'Campus Allies',       // Stage 4 (Automatically became Allies)
] as const;

/** day_streak required to be AT that stage index.
 * Stage 0: 0 days (Handshake / Pre-chat)
 * Stage 1: 0 days (Once chatting begins)
 * Stage 2: 3 days
 * Stage 3: 7 days
 * Stage 4: 10 days
 */
export const STAGE_THRESHOLDS = [0, 0, 3, 7, 10];

export interface StageCapabilities {
  stage: number;
  stageName: string;
  canChat: boolean;
  canPlayGames: boolean;
  canUploadImages: boolean;
  isAllies: boolean;
  isRevealed: boolean;
}

export function getStageCapabilities(stage: number): StageCapabilities {
  return {
    stage,
    stageName: stageName(stage),
    canChat: stage >= 1,
    canPlayGames: stage >= 2,
    canUploadImages: stage >= 3,
    isAllies: stage >= 4,
    isRevealed: stage >= 4,
  };
}

export function stageForStreak(days: number): number {
  let stage = 1;
  for (let i = STAGE_THRESHOLDS.length - 1; i >= 1; i--) {
    if (days >= STAGE_THRESHOLDS[i]) {
      stage = i;
      break;
    }
  }
  return stage;
}

export function stageName(stage: number): string {
  return STAGE_NAMES[stage] ?? STAGE_NAMES[1];
}
