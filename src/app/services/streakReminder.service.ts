// src/app/services/streakReminder.service.ts

import { supabaseAdmin } from '../../config/supabase';
import { phtDateStr, getCalendarDateOffset, phtMidnightUtc, getPhtHoursAndMinutes } from '../utils/pht';
import { sendExpoPushNotification } from './pushNotification.service';
import { getPushTokens } from '../models/pushToken.model';
import { emitToUser } from './realtime.service';
import { MIN_MESSAGES_PER_VALID_DAY } from '../models/conversationStreak.model';
import * as streakModel from '../models/conversationStreak.model';
import { syncMatchProgression } from './conversationStreak.service';

let lastRunPhtDate: string | null = null;
let schedulerTimer: NodeJS.Timeout | null = null;

export interface StreakReminderOptions {
  force?: boolean;
  userId?: string;
}

/**
 * Checks all conversations with an active streak (> 0).
 * If today's PHT streak has not yet been extended/activated,
 * sends a reminder notification to the members who still need to send a message.
 */
export async function checkAndSendStreakReminders(options?: StreakReminderOptions): Promise<{
  conversationsChecked: number;
  remindersSent: number;
}> {
  const force = options?.force ?? false;
  const today = phtDateStr();
  const yesterday = getCalendarDateOffset(today, -1);
  console.log(`[StreakReminder] Checking unactivated streaks for PHT date: ${today} (force=${force})`);

  // 1. Fetch conversations with an ongoing streak (> 0)
  const { data: streaks, error: streakErr } = await supabaseAdmin
    .from('conversation_streaks')
    .select('conversation_id, day_streak, streak_last_active_pht')
    .gt('day_streak', 0);

  if (streakErr) {
    console.error('[StreakReminder] Failed to query conversation_streaks:', streakErr);
    return { conversationsChecked: 0, remindersSent: 0 };
  }

  let targetStreaks = streaks || [];

  // If force mode and no active streaks found, fall back to recent conversations so testing succeeds
  if (force && targetStreaks.length === 0) {
    console.log('[StreakReminder] Force mode: No active streaks found. Falling back to active conversations.');
    const { data: convs } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .order('updated_at', { ascending: false })
      .limit(5);

    if (convs && convs.length > 0) {
      targetStreaks = convs.map((c) => ({
        conversation_id: c.id,
        day_streak: 1,
        streak_last_active_pht: yesterday,
      }));
    }
  }

  if (targetStreaks.length === 0) {
    console.log('[StreakReminder] No active streaks or conversations found.');
    return { conversationsChecked: 0, remindersSent: 0 };
  }

  // 2. Filter for conversations where the streak was NOT yet activated today:
  // In normal mode: streak_last_active_pht !== today
  // In force mode: all target streaks
  const pendingStreaks = force
    ? targetStreaks
    : targetStreaks.filter((row) => row.streak_last_active_pht !== today);

  console.log(
    `[StreakReminder] Found ${pendingStreaks.length} conversation(s) with streak to process.`
  );

  let remindersSent = 0;
  const midnightUtc = phtMidnightUtc(today);

  for (const streak of pendingStreaks) {
    const conversationId = streak.conversation_id as string;

    // Get members of this conversation
    const { data: members, error: memErr } = await supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId);

    if (memErr || !members || members.length === 0) continue;

    // Get daily activity for today to see who has not messaged yet
    const { data: activityRows } = await supabaseAdmin
      .from('conversation_daily_activity')
      .select('user_id, message_count')
      .eq('conversation_id', conversationId)
      .eq('activity_date', today);

    const activeUserIds = new Set(
      (activityRows || [])
        .filter((r) => r.message_count >= MIN_MESSAGES_PER_VALID_DAY)
        .map((r) => r.user_id)
    );

    // Notify participants who still need to send a message
    const targetUserIds = members
      .map((m) => m.user_id as string)
      .filter((uid) => !activeUserIds.has(uid));

    // Fallback: If both need to be notified, or in force mode
    let notifyUserIds = targetUserIds.length > 0 ? targetUserIds : members.map((m) => m.user_id as string);

    // Filter by specific user if provided
    if (options?.userId) {
      notifyUserIds = notifyUserIds.filter((uid) => uid === options.userId);
    }

    for (const userId of notifyUserIds) {
      // In normal mode: check if already notified today to prevent spam.
      // In force mode: allow sending test notifications.
      if (!force) {
        const { data: existingNotifs } = await supabaseAdmin
          .from('notifications')
          .select('id, description')
          .eq('user_id', userId)
          .eq('type', 'streak_reminder')
          .gte('created_at', midnightUtc);

        const alreadyNotified = (existingNotifs || []).some((n) =>
          n.description?.includes(conversationId)
        );

        if (alreadyNotified) {
          continue;
        }
      }

      // Check user preferences for streak reminder opt-out
      try {
        const { getUserPreferences } = await import('../models/userPreferences.model');
        const prefs = await getUserPreferences(userId);
        if (prefs && prefs.notify_streak_reminders === false) {
          continue;
        }
      } catch (prefErr) {
        // Non-blocking: proceed if preference fetch fails
      }

      const notifTitle = 'Streak Reminder 🔥';
      const notifDesc = 'Your streak is not yet activated! Send a message to activate.';

      const { dispatchStreakReminderNotification } = await import('./notificationEngine.service');
      await dispatchStreakReminderNotification({
        recipientId: userId,
        conversationId,
        title: notifTitle,
        description: notifDesc,
      }).catch((err) => {
        console.error(`[StreakReminder] Failed to dispatch notification for user ${userId}:`, err);
      });

      remindersSent++;
      emitToUser(userId, 'streak:reminder', { conversationId });
    }
  }


  console.log(`[StreakReminder] Finished check. Sent ${remindersSent} reminders.`);
  return { conversationsChecked: pendingStreaks.length, remindersSent };
}

let lastRunMidnightPhtDate: string | null = null;

/**
 * At the end of the day (12:00 AM PHT):
 * 1. Resets streak to 0 for any conversation that was not activated today.
 * 2. Auto-ends the associated anonymous match (if any) when neither participant
 *    chatted that day — so users see the conversation close automatically.
 *
 * Emits 'conversation:streak_updated' (dayStreak: 0, status: 'lapsed'/'expired')
 * and 'conversation:streak_event' to all affected members.
 * Note: Matches are NEVER automatically ended; users decide whether to end them.
 */
export async function expireUnactivatedStreaks(): Promise<{
  expiredCount: number;
  autoEndedMatches: number;
}> {
  const today = phtDateStr();
  const yesterday = getCalendarDateOffset(today, -1);
  console.log(`[StreakExpiration] Checking streaks to expire for PHT midnight. Today: ${today}, yesterday: ${yesterday}`);

  // Fetch all conversations with day_streak > 0
  const { data: streaks, error } = await supabaseAdmin
    .from('conversation_streaks')
    .select('conversation_id, day_streak, streak_last_active_pht')
    .gt('day_streak', 0);

  if (error || !streaks || streaks.length === 0) {
    if (error) console.error('[StreakExpiration] Failed to query conversation_streaks:', error);
    return { expiredCount: 0, autoEndedMatches: 0 };
  }

  // A streak expires if yesterday was NOT active (streak_last_active_pht !== yesterday)
  // and today is not active (streak_last_active_pht !== today)
  const expiredStreaks = streaks.filter(
    (row) => row.streak_last_active_pht !== yesterday && row.streak_last_active_pht !== today
  );

  console.log(`[StreakExpiration] Found ${expiredStreaks.length} streak(s) to transition to lapsed/expired.`);

  let expiredCount = 0;

  for (const streak of expiredStreaks) {
    const conversationId = streak.conversation_id as string;
    const lastActivePht = streak.streak_last_active_pht as string | null;

    // 1. Mark streak as lapsed in DB (remembers count for 42h restore and writes 'ended' event)
    let lapsedEvent: streakModel.StreakEventRow | null = null;
    if (lastActivePht && streak.day_streak > 0) {
      try {
        lapsedEvent = await streakModel.markStreakLapsed(
          conversationId,
          streak.day_streak,
          lastActivePht,
        );
      } catch (err) {
        console.error(`[StreakExpiration] Error recording lapsed streak for ${conversationId}:`, err);
      }
    } else {
      await supabaseAdmin
        .from('conversation_streaks')
        .update({ day_streak: 0, updated_at: new Date().toISOString() })
        .eq('conversation_id', conversationId);
    }

    // 2. Synchronize day_streak AND level in matches table if linked match exists.
    //    The level ends together with the streak (Lv.4 Campus Allies is permanent).
    // NOTE: NEVER auto-end matches when streak ends! Matches only end when user explicitly chooses to end them.
    await syncMatchProgression(conversationId, 0, lastActivePht);

    // 3. Get members to broadcast realtime lapsed/inactive status and streak event
    const { data: members } = await supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId);

    const memberIds = (members ?? []).map((m) => m.user_id as string);

    let streakStatus: streakModel.StreakStatus = 'inactive';
    let expiresAt: string | null = null;
    let streakRestoreDeadline: string | null = null;

    if (lastActivePht) {
      const deadline = streakModel.computeRestoreDeadline(lastActivePht);
      const isRestorable = deadline.getTime() > Date.now();
      streakStatus = isRestorable ? 'lapsed' : 'expired';
      expiresAt = isRestorable ? deadline.toISOString() : null;
      streakRestoreDeadline = isRestorable ? deadline.toISOString() : null;
    }

    const streakPayload = {
      conversationId,
      currentStreak: 0,
      dayStreak: 0,
      streakActiveToday: false,
      streakStatus,
      lastQualifyingDate: lastActivePht,
      expiresAt,
      streakRestoreDeadline,
      lapsedStreak: streak.day_streak,
      status: streakStatus,
    };

    for (const memberId of memberIds) {
      emitToUser(memberId, 'conversation:streak_updated', streakPayload);
      if (lapsedEvent) {
        emitToUser(memberId, 'conversation:streak_event', lapsedEvent);
      }
    }

    expiredCount++;
  }

  console.log(`[StreakExpiration] Done. Expired/lapsed: ${expiredCount}. Matches were NOT ended.`);
  return { expiredCount, autoEndedMatches: 0 };
}

/**
 * Initializes the background interval scheduler checking for:
 * - 10:00 PM PHT (streak reminder notifications)
 * - 12:00 AM PHT (midnight streak expiration + auto-end for inactive matches)
 */
export function initStreakReminderScheduler(): void {
  if (schedulerTimer) return;

  console.log('[StreakScheduler] Initializing 10:00 PM reminder & 12:00 AM expiration scheduler...');

  const tick = async () => {
    try {
      const { hours, dateStr } = getPhtHoursAndMinutes();

      // Trigger at 10 PM (22:00) PHT for reminders
      if (hours === 22 && lastRunPhtDate !== dateStr) {
        console.log(`[StreakReminder] 10:00 PM PHT reached for ${dateStr}. Running reminders...`);
        lastRunPhtDate = dateStr;
        await checkAndSendStreakReminders();
      }

      // Trigger at 12 AM (00:00) PHT for midnight streak expiration + auto-end
      if (hours === 0 && lastRunMidnightPhtDate !== dateStr) {
        console.log(`[StreakExpiration] 12:00 AM PHT midnight reached for ${dateStr}. Expiring unactivated streaks...`);
        lastRunMidnightPhtDate = dateStr;
        await expireUnactivatedStreaks();
      }
    } catch (err) {
      console.error('[StreakScheduler] Error in scheduler tick:', err);
    }
  };

  // Run every 60 seconds
  schedulerTimer = setInterval(tick, 60_000);
  void tick();
}

export function stopStreakReminderScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
