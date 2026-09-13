// src/app/services/streakReminder.service.ts

import { supabaseAdmin } from '../../config/supabase';
import { phtDateStr, phtMidnightUtc, getPhtHoursAndMinutes } from '../utils/pht';
import { sendExpoPushNotification } from './pushNotification.service';
import { getPushTokens } from '../models/pushToken.model';
import { emitToUser } from './realtime.service';
import { MIN_MESSAGES_PER_VALID_DAY } from '../models/conversationStreak.model';

let lastRunPhtDate: string | null = null;
let schedulerTimer: NodeJS.Timeout | null = null;

/**
 * Checks all conversations with an active streak (> 0).
 * If today's PHT streak has not yet been extended/activated,
 * sends a reminder notification to the members who still need to send a message.
 */
export async function checkAndSendStreakReminders(): Promise<{
  conversationsChecked: number;
  remindersSent: number;
}> {
  const today = phtDateStr();
  console.log(`[StreakReminder] Checking unactivated streaks for PHT date: ${today}`);

  // 1. Fetch conversations with an ongoing streak (> 0)
  const { data: streaks, error: streakErr } = await supabaseAdmin
    .from('conversation_streaks')
    .select('conversation_id, day_streak, streak_last_active_pht')
    .gt('day_streak', 0);

  if (streakErr) {
    console.error('[StreakReminder] Failed to query conversation_streaks:', streakErr);
    return { conversationsChecked: 0, remindersSent: 0 };
  }

  if (!streaks || streaks.length === 0) {
    console.log('[StreakReminder] No active streaks found.');
    return { conversationsChecked: 0, remindersSent: 0 };
  }

  // 2. Filter for conversations where today's streak has NOT yet been activated
  const pendingStreaks = streaks.filter(
    (row) => row.streak_last_active_pht !== today
  );

  console.log(
    `[StreakReminder] Found ${pendingStreaks.length} conversation(s) with streak not yet activated today.`
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

    // Fallback: If both need to be notified
    const notifyUserIds = targetUserIds.length > 0 ? targetUserIds : members.map((m) => m.user_id as string);

    for (const userId of notifyUserIds) {
      // Check if already notified today to prevent spam
      const { data: existingNotifs } = await supabaseAdmin
        .from('notifications')
        .select('id')
        .eq('user_id', userId)
        .eq('type', 'streak_reminder')
        .eq('target_id', conversationId)
        .gte('created_at', midnightUtc)
        .limit(1);

      if (existingNotifs && existingNotifs.length > 0) {
        continue;
      }

      const notifTitle = 'Streak Reminder 🔥';
      const notifDesc = 'Your streak is not yet activated! Send a message to activate.';

      // Insert DB notification
      const { error: insErr } = await supabaseAdmin.from('notifications').insert({
        user_id: userId,
        type: 'streak_reminder',
        title: notifTitle,
        description: notifDesc,
        target_id: conversationId,
        is_read: false,
      });

      if (!insErr) {
        remindersSent++;
        // Emit real-time socket event
        emitToUser(userId, 'notification:new', {
          type: 'streak_reminder',
          title: notifTitle,
          description: notifDesc,
          targetId: conversationId,
        });
        emitToUser(userId, 'streak:reminder', { conversationId });
      }

      // Push notification
      try {
        const tokenMap = await getPushTokens([userId]);
        const pushToken = tokenMap.get(userId);
        if (pushToken) {
          await sendExpoPushNotification([
            {
              to: pushToken,
              sound: 'default',
              title: notifTitle,
              body: notifDesc,
              data: {
                conversationId,
                type: 'streak_reminder',
              },
            },
          ]);
        }
      } catch (pushErr) {
        console.warn(`[StreakReminder] Failed to push to user ${userId}:`, pushErr);
      }
    }
  }

  console.log(`[StreakReminder] Finished check. Sent ${remindersSent} reminders.`);
  return { conversationsChecked: pendingStreaks.length, remindersSent };
}

/**
 * Initializes the background interval scheduler checking for 10:00 PM PHT.
 */
export function initStreakReminderScheduler(): void {
  if (schedulerTimer) return;

  console.log('[StreakReminder] Initializing 10:00 PM PHT streak reminder scheduler...');

  const tick = async () => {
    try {
      const { hours, dateStr } = getPhtHoursAndMinutes();
      // Trigger at 10 PM (22:00) PHT
      if (hours === 22 && lastRunPhtDate !== dateStr) {
        console.log(`[StreakReminder] 10:00 PM PHT reached for ${dateStr}. Running reminders...`);
        lastRunPhtDate = dateStr;
        await checkAndSendStreakReminders();
      }
    } catch (err) {
      console.error('[StreakReminder] Error in scheduler tick:', err);
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
