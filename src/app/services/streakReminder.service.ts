// src/app/services/streakReminder.service.ts

import { supabaseAdmin } from '../../config/supabase';
import { phtDateStr, phtDateStrOffset, phtMidnightUtc, getPhtHoursAndMinutes } from '../utils/pht';
import { sendExpoPushNotification } from './pushNotification.service';
import { getPushTokens } from '../models/pushToken.model';
import { emitToUser } from './realtime.service';
import { MIN_MESSAGES_PER_VALID_DAY } from '../models/conversationStreak.model';

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
  const yesterday = phtDateStrOffset(-1);
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

      const notifTitle = 'Streak Reminder 🔥';
      const notifDesc = 'Your streak is not yet activated! Send a message to activate.';
      const descWithMeta = `<!--meta:${JSON.stringify({ targetId: conversationId })}-->${notifDesc}`;

      // Insert DB notification (embedding targetId in description metadata)
      const { error: insErr } = await supabaseAdmin.from('notifications').insert({
        user_id: userId,
        type: 'streak_reminder',
        title: notifTitle,
        description: descWithMeta,
        is_read: false,
      });

      if (insErr) {
        console.error(`[StreakReminder] Failed to insert notification for user ${userId}:`, insErr);
      }

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

let lastRunMidnightPhtDate: string | null = null;

/**
 * At the end of the day (12:00 AM PHT):
 * 1. Resets streak to 0 for any conversation that was not activated today.
 * 2. Auto-ends the associated anonymous match (if any) when neither participant
 *    chatted that day — so users see the conversation close automatically.
 *
 * Emits 'conversation:streak_updated' (dayStreak: 0, status: 'inactive')
 * and 'matchmaking:match_ended' to all affected members.
 */
export async function expireUnactivatedStreaks(): Promise<{
  expiredCount: number;
  autoEndedMatches: number;
}> {
  const today = phtDateStr();
  const yesterday = phtDateStrOffset(-1);
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

  console.log(`[StreakExpiration] Found ${expiredStreaks.length} streak(s) to reset to inactive.`);

  let expiredCount = 0;
  let autoEndedMatches = 0;

  for (const streak of expiredStreaks) {
    const conversationId = streak.conversation_id as string;

    // 1. Reset conversation_streaks in DB
    await supabaseAdmin
      .from('conversation_streaks')
      .update({ day_streak: 0, updated_at: new Date().toISOString() })
      .eq('conversation_id', conversationId);

    // 2. Check if this conversation has an active anonymous match to auto-end
    const { data: matchRow } = await supabaseAdmin
      .from('matches')
      .select('id, user_a_id, user_b_id, status, conversation_id')
      .eq('conversation_id', conversationId)
      .in('status', ['chatting', 'confirmed'])
      .maybeSingle();

    // 3. Get members to broadcast realtime inactive status
    const { data: members } = await supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId);

    const memberIds = (members ?? []).map((m) => m.user_id as string);

    const streakPayload = {
      conversationId,
      dayStreak: 0,
      streakActiveToday: false,
      status: 'inactive' as const,
    };

    for (const memberId of memberIds) {
      emitToUser(memberId, 'conversation:streak_updated', streakPayload);
      emitToUser(memberId, 'matchmaking:streak_update', streakPayload);
    }

    // 4. Auto-end the anonymous match if it exists and was not chatted yesterday
    if (matchRow) {
      // Check if anyone sent a message yesterday in this conversation
      const { data: yesterdayActivity } = await supabaseAdmin
        .from('conversation_daily_activity')
        .select('user_id, message_count')
        .eq('conversation_id', conversationId)
        .eq('activity_date', yesterday);

      const anyActivityYesterday = (yesterdayActivity ?? []).some((r) => r.message_count > 0);

      if (!anyActivityYesterday) {
        console.log(`[StreakExpiration] Auto-ending match ${matchRow.id} for conversation ${conversationId} — no activity yesterday.`);

        // Mark match as ended
        await supabaseAdmin
          .from('matches')
          .update({ status: 'ended', updated_at: new Date().toISOString() })
          .eq('id', matchRow.id);

        // Also reset matches day_streak
        await supabaseAdmin
          .from('matches')
          .update({ day_streak: 0 })
          .eq('id', matchRow.id);

        // Emit match_ended to both participants
        const matchEndPayload = { matchId: matchRow.id, conversationId, reason: 'midnight_auto_end' };
        for (const memberId of memberIds) {
          emitToUser(memberId, 'matchmaking:match_ended', matchEndPayload);
        }

        autoEndedMatches++;
      }
    }

    expiredCount++;
  }

  // 5. Also auto-end any other active matches where no one chatted yesterday (even if day_streak was 0)
  const { data: activeMatches } = await supabaseAdmin
    .from('matches')
    .select('id, user_a_id, user_b_id, status, conversation_id, confirmed_at, created_at')
    .in('status', ['chatting', 'confirmed']);

  for (const m of activeMatches ?? []) {
    if (!m.conversation_id) continue;

    // Grace period: do not auto-end matches created within the last 2 hours
    const matchTime = new Date(m.confirmed_at || m.created_at || 0).getTime();
    if (Date.now() - matchTime < 2 * 60 * 60 * 1000) continue;

    const { data: yAct } = await supabaseAdmin
      .from('conversation_daily_activity')
      .select('user_id, message_count')
      .eq('conversation_id', m.conversation_id)
      .eq('activity_date', yesterday);

    const hadChatYesterday = (yAct ?? []).some((r) => r.message_count > 0);
    if (!hadChatYesterday) {
      console.log(`[StreakExpiration] Auto-ending match ${m.id} (conv: ${m.conversation_id}) — no messages sent yesterday.`);

      await supabaseAdmin
        .from('matches')
        .update({ status: 'ended', updated_at: new Date().toISOString() })
        .eq('id', m.id);

      await supabaseAdmin
        .from('matches')
        .update({ day_streak: 0 })
        .eq('id', m.id);

      const endPayload = { matchId: m.id, conversationId: m.conversation_id, reason: 'midnight_auto_end' };
      emitToUser(m.user_a_id, 'matchmaking:match_ended', endPayload);
      emitToUser(m.user_b_id, 'matchmaking:match_ended', endPayload);

      autoEndedMatches++;
    }
  }

  console.log(`[StreakExpiration] Done. Expired: ${expiredCount}, auto-ended matches: ${autoEndedMatches}.`);
  return { expiredCount, autoEndedMatches };
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
