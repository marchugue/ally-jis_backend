// src/app/constants/progression.ts

/** A day only counts toward the streak if BOTH sides sent at least this
 * many messages — prevents a single "hi" from padding the streak. */
export const MIN_MESSAGES_PER_VALID_DAY = 3;

export const STAGE_NAMES = [
  'Stranger',
  'Comfortable',
  'Trust Building',
  'Familiar',
  'Close Connection',
] as const;

/** day_streak required to be AT that stage index. */
export const STAGE_THRESHOLDS = [0, 3, 5, 7, 10];

export function stageForStreak(days: number): number {
  let stage = 0;
  for (let i = STAGE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (days >= STAGE_THRESHOLDS[i]) {
      stage = i;
      break;
    }
  }
  return stage;
}

export function stageName(stage: number): string {
  return STAGE_NAMES[stage] ?? STAGE_NAMES[0];
}
