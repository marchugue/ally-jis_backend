// src/app/constants/progression.ts

/** A day counts toward the streak when BOTH members have sent at least
 * 1 message that PHT calendar day (12:00 AM → 11:59:59 PM).
 * A single exchange is enough — the streak rewards showing up, not volume. */
export const MIN_MESSAGES_PER_VALID_DAY = 1;

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
