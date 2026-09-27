// src/app/services/notificationEngine.service.ts
//
// Facebook-Style Notification Decision Engine
// --------------------------------------------
// Manages the complete lifecycle of notifications across Ally:
// - Eliminates duplicate stacking by updating, grouping, or replacing notifications
// - Evaluates incoming events before deciding: CREATE, UPDATE, GROUP, or REPLACE
// - Enforces push notification rules (only high-priority events interrupt users)
// - Synchronizes read states and automatic tray dismissals in real-time across Web and Mobile

import { supabaseAdmin } from '../../config/supabase';
import * as notificationModel from '../models/notification.model';
import { getPushTokens } from '../models/pushToken.model';
import { sendExpoPushNotification } from './pushNotification.service';
import { emitToUser } from './realtime.service';
import { computeNotificationRedirection } from './notification.service';
import type { NotificationCategory, NotificationRow } from '../types/notification.types';

// ============================================================================
// Helper Utilities
// ============================================================================

/**
 * Calculates current unread notification count for a user to update device badges.
 */
async function getUnreadBadgeCount(userId: string): Promise<number> {
  try {
    const { count } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    return typeof count === 'number' ? count : 1;
  } catch {
    return 1;
  }
}

/**
 * Embeds JSON metadata in HTML comment prefix within the description.
 * This guarantees 100% database schema backward-compatibility across all environments.
 */
function formatDescriptionWithMeta(
  plainText: string,
  meta: {
    targetId?: string | null;
    groupKey?: string | null;
    category?: NotificationCategory | null;
    unreadCount?: number;
    postId?: string | null;
    commentId?: string | null;
    parentId?: string | null;
    childId?: string | null;
  }
): string {
  const cleanText = plainText.replace(/^<!--meta:\{[^}]*\}-->/i, '').trim();
  const metaJson = JSON.stringify(meta);
  return `<!--meta:${metaJson}-->${cleanText}`;
}

/**
 * Builds a standardized NotificationRow payload with redirection attached for clients.
 */
function buildClientPayload(row: Partial<NotificationRow>): NotificationRow {
  const targetId = row.target_id ?? null;
  const postId = row.post_id ?? null;
  const commentId = row.comment_id ?? null;
  const parentId = row.parent_id ?? null;
  const childId = row.child_id ?? null;
  const fromUserId = row.from_user_id ?? null;
  const type = row.type ?? 'system';

  const redirection = computeNotificationRedirection(
    type,
    targetId,
    postId,
    commentId,
    fromUserId,
    parentId,
    childId
  );

  return {
    id: row.id || '',
    user_id: row.user_id || '',
    type,
    title: row.title || '',
    description: row.description || '',
    is_read: row.is_read ?? false,
    from_user_id: fromUserId,
    target_id: targetId,
    group_key: row.group_key ?? null,
    category: row.category ?? null,
    unread_count: row.unread_count ?? 1,
    post_id: postId,
    comment_id: commentId,
    parent_id: parentId,
    child_id: childId,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
    from_user: row.from_user ?? null,
    redirection,
  };
}

// ============================================================================
// Decision Engine Dispatchers
// ============================================================================

/**
 * 1. MESSAGES (Facebook/Messenger-Style: One notification per conversation that updates)
 * - First message in conversation: Create notification
 * - Additional messages: Update existing notification (e.g. "Alex (3 new messages)")
 * - Always dispatches or updates the single push notification with correct unread badge.
 */
export async function dispatchMessageNotification(input: {
  recipientId: string;
  senderId: string;
  senderName: string;
  conversationId: string;
  content?: string | null;
  isAnonymous?: boolean;
}): Promise<void> {
  const { recipientId, senderId, senderName, conversationId, content, isAnonymous } = input;
  const groupKey = `conversation:${conversationId}`;
  const category: NotificationCategory = 'messages';
  const type = isAnonymous ? 'anon_match' : 'message';

  const previewSnippet = content
    ? content.length > 80 ? content.slice(0, 77) + '...' : content
    : '📷 Sent a photo';

  // Check if an unread notification exists for this conversation
  const existing = await notificationModel.findUnreadByConversation(recipientId, conversationId);

  let finalNotificationId: string;
  let finalUnreadCount = 1;
  let finalTitle = senderName;

  if (existing) {
    // ── Additional messages: UPDATE existing notification ──
    finalNotificationId = existing.id;
    finalUnreadCount = (existing.unread_count || 1) + 1;
    finalTitle = `${senderName} (${finalUnreadCount} new messages)`;

    const descWithMeta = formatDescriptionWithMeta(previewSnippet, {
      targetId: conversationId,
      groupKey,
      category,
      unreadCount: finalUnreadCount,
    });

    const updatePayload: Record<string, any> = {
      title: finalTitle,
      description: descWithMeta,
      is_read: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      unread_count: finalUnreadCount,
      target_id: conversationId,
      group_key: groupKey,
      category,
    };

    await notificationModel.updateNotification(existing.id, updatePayload);

    const clientRow = buildClientPayload({
      ...existing,
      ...updatePayload,
      description: previewSnippet,
    });

    emitToUser(recipientId, 'notification:updated', clientRow);
    emitToUser(recipientId, 'notification:new', clientRow);
  } else {
    // ── First message: CREATE new notification ──
    finalUnreadCount = 1;
    finalTitle = senderName;

    const descWithMeta = formatDescriptionWithMeta(previewSnippet, {
      targetId: conversationId,
      groupKey,
      category,
      unreadCount: 1,
    });

    const insertPayload: Record<string, any> = {
      user_id: recipientId,
      type,
      title: finalTitle,
      description: descWithMeta,
      from_user_id: isAnonymous ? null : senderId,
      is_read: false,
      target_id: conversationId,
      group_key: groupKey,
      category,
      unread_count: 1,
    };

    let insertedId = '';
    const { data: inserted, error } = await supabaseAdmin
      .from('notifications')
      .insert(insertPayload)
      .select('id, created_at')
      .maybeSingle();

    if (error) {
      // Fallback without extended schema columns
      const fallbackPayload = {
        user_id: recipientId,
        type,
        title: finalTitle,
        description: descWithMeta,
        from_user_id: isAnonymous ? null : senderId,
        is_read: false,
      };
      const { data: fbData } = await supabaseAdmin
        .from('notifications')
        .insert(fallbackPayload)
        .select('id, created_at')
        .maybeSingle();
      insertedId = fbData?.id || '';
    } else {
      insertedId = inserted?.id || '';
    }
    finalNotificationId = insertedId;

    const clientRow = buildClientPayload({
      id: finalNotificationId,
      user_id: recipientId,
      type,
      title: finalTitle,
      description: previewSnippet,
      from_user_id: isAnonymous ? null : senderId,
      is_read: false,
      target_id: conversationId,
      group_key: groupKey,
      category,
      unread_count: 1,
      created_at: new Date().toISOString(),
    });

    emitToUser(recipientId, 'notification:new', clientRow);
  }

  // ── Push Notification dispatch (Allowed: updates existing card) ──────────
  try {
    const tokenMap = await getPushTokens([recipientId]);
    const pushToken = tokenMap.get(recipientId);
    if (pushToken) {
      const badgeCount = await getUnreadBadgeCount(recipientId);
      // Group overwrite for the same user / conversation:
      // tag on Android replaces any existing notification with this tag in the notification tray
      // collapseId on iOS replaces any existing notification with this collapseId in the notification tray
      const pushTag = isAnonymous ? `conv_${conversationId}` : `user_${senderId}`;
      const pushCollapseId = isAnonymous ? `conv_${conversationId}` : `user_${senderId}`;
      const pushThreadId = isAnonymous ? `conv_${conversationId}` : `user_${senderId}`;

      await sendExpoPushNotification({
        to: pushToken,
        sound: 'default',
        title: finalTitle,
        body: previewSnippet,
        channelId: 'default',
        categoryId: 'message_actions',
        badge: badgeCount,
        tag: pushTag,
        collapseId: pushCollapseId,
        threadId: pushThreadId,
        data: {
          conversationId,
          senderId,
          senderName,
          groupKey,
          category: 'messages',
          type,
          unreadCount: finalUnreadCount,
          tag: pushTag,
          collapseId: pushCollapseId,
        },
      });
    }
  } catch (err) {
    console.warn('[dispatchMessageNotification] Push dispatch failed:', err);
  }
}

/**
 * 2. CONNECTION REQUESTS (Jamie wants to connect with you)
 * - Standalone notification
 * - Push notification allowed
 */
export async function dispatchConnectionRequestNotification(input: {
  recipientId: string;
  requesterId: string;
  requesterName: string;
  conversationId?: string;
  isAnonymous?: boolean;
}): Promise<void> {
  const { recipientId, requesterId, requesterName, conversationId, isAnonymous } = input;
  const groupKey = `connection:${requesterId}`;
  const category: NotificationCategory = 'connections';
  const type = isAnonymous ? 'friend_request' : 'connection_request';

  const title = isAnonymous ? 'New Anonymous Match!' : `${requesterName} wants to connect with you`;
  const plainDesc = isAnonymous
    ? 'An anonymous peer wants to connect with you! Say hello in anonymous chat.'
    : `${requesterName} sent you a connection request.`;

  const descWithMeta = formatDescriptionWithMeta(plainDesc, {
    targetId: conversationId || requesterId,
    groupKey,
    category,
    unreadCount: 1,
  });

  const insertPayload: Record<string, any> = {
    user_id: recipientId,
    type,
    title,
    description: descWithMeta,
    from_user_id: requesterId,
    is_read: false,
    target_id: conversationId || requesterId,
    group_key: groupKey,
    category,
    unread_count: 1,
  };

  let insertedId = '';
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert(insertPayload)
    .select('id')
    .maybeSingle();

  if (error) {
    const fallback = {
      user_id: recipientId,
      type,
      title,
      description: descWithMeta,
      from_user_id: requesterId,
      is_read: false,
    };
    const res = await supabaseAdmin.from('notifications').insert(fallback).select('id').maybeSingle();
    insertedId = res.data?.id || '';
  } else {
    insertedId = data?.id || '';
  }

  const clientRow = buildClientPayload({
    id: insertedId,
    user_id: recipientId,
    type,
    title,
    description: plainDesc,
    from_user_id: requesterId,
    is_read: false,
    target_id: conversationId || requesterId,
    group_key: groupKey,
    category,
    unread_count: 1,
    created_at: new Date().toISOString(),
  });

  emitToUser(recipientId, 'notification:new', clientRow);

  // Standalone push notification
  try {
    const tokenMap = await getPushTokens([recipientId]);
    const pushToken = tokenMap.get(recipientId);
    if (pushToken) {
      const badge = await getUnreadBadgeCount(recipientId);
      const connTag = `conn_user_${requesterId}`;
      await sendExpoPushNotification({
        to: pushToken,
        sound: 'default',
        title,
        body: plainDesc,
        channelId: 'default',
        badge,
        tag: connTag,
        collapseId: connTag,
        threadId: connTag,
        data: {
          requesterId,
          conversationId,
          groupKey,
          category: 'connections',
          type,
          tag: connTag,
          collapseId: connTag,
        },
      });
    }
  } catch (err) {
    console.warn('[dispatchConnectionRequestNotification] Push dispatch failed:', err);
  }
}

/**
 * 3. CONNECTION ACCEPTED (You're now connected with Jamie / Match Accepted)
 * - REPLACE previous connection notification
 * - Push notification allowed: replaces previous notification card
 */
export async function dispatchConnectionAcceptedNotification(input: {
  recipientId: string;
  acceptorId: string;
  acceptorName: string;
  conversationId: string;
  isAnonymous?: boolean;
}): Promise<void> {
  const { recipientId, acceptorId, acceptorName, conversationId, isAnonymous } = input;
  const groupKey = `connection:${acceptorId}`;
  const category: NotificationCategory = 'connections';
  const type = isAnonymous ? 'connection_accepted' : 'accepted';

  // ── Step 1: Clean up any old pending request notifications for both users ──
  await notificationModel.deleteFriendRequestNotification(recipientId, acceptorId).catch(() => {});
  await notificationModel.deleteFriendRequestNotification(acceptorId, recipientId).catch(() => {});

  // ── Step 2: REPLACE previous notification with the accepted state ──
  const title = isAnonymous ? 'Match Request Accepted!' : `You're now connected with ${acceptorName}`;
  const plainDesc = isAnonymous
    ? 'Your match request was accepted! Start your anonymous chat to begin the Ally Roadmap.'
    : `You and ${acceptorName} are now connected. Say hello!`;

  const descWithMeta = formatDescriptionWithMeta(plainDesc, {
    targetId: conversationId,
    groupKey,
    category,
    unreadCount: 1,
  });

  const insertPayload: Record<string, any> = {
    user_id: recipientId,
    type,
    title,
    description: descWithMeta,
    from_user_id: isAnonymous ? null : acceptorId,
    is_read: false,
    target_id: conversationId,
    group_key: groupKey,
    category,
    unread_count: 1,
  };

  let insertedId = '';
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert(insertPayload)
    .select('id')
    .maybeSingle();

  if (error) {
    const fallback = {
      user_id: recipientId,
      type,
      title,
      description: descWithMeta,
      from_user_id: isAnonymous ? null : acceptorId,
      is_read: false,
    };
    const res = await supabaseAdmin.from('notifications').insert(fallback).select('id').maybeSingle();
    insertedId = res.data?.id || '';
  } else {
    insertedId = data?.id || '';
  }

  const clientRow = buildClientPayload({
    id: insertedId,
    user_id: recipientId,
    type,
    title,
    description: plainDesc,
    from_user_id: isAnonymous ? null : acceptorId,
    is_read: false,
    target_id: conversationId,
    group_key: groupKey,
    category,
    unread_count: 1,
    created_at: new Date().toISOString(),
  });

  // Emit event so devices replace or insert
  emitToUser(recipientId, 'notification:new', clientRow);

  // Push notification: replaces previous connection notification
  try {
    const tokenMap = await getPushTokens([recipientId]);
    const pushToken = tokenMap.get(recipientId);
    if (pushToken) {
      const badge = await getUnreadBadgeCount(recipientId);
      const connTag = `conn_user_${acceptorId}`;
      await sendExpoPushNotification({
        to: pushToken,
        sound: 'default',
        title,
        body: plainDesc,
        channelId: 'default',
        badge,
        tag: connTag,
        collapseId: connTag,
        threadId: connTag,
        data: {
          acceptorId,
          conversationId,
          groupKey,
          category: 'connections',
          type,
          tag: connTag,
          collapseId: connTag,
        },
      });
    }
  } catch (err) {
    console.warn('[dispatchConnectionAcceptedNotification] Push dispatch failed:', err);
  }
}

/**
 * 4. ALLY MATCHED (Standalone push allowed)
 */
export async function dispatchAllyMatchedNotification(input: {
  recipientId: string;
  conversationId: string;
  matchId: string;
  partnerAlias?: string;
}): Promise<void> {
  const { recipientId, conversationId, matchId, partnerAlias } = input;
  const groupKey = `ally:${matchId}`;
  const category: NotificationCategory = 'ally';
  const type = 'match';

  const title = 'Your Ally connection is ready!';
  const plainDesc = partnerAlias
    ? `You matched with ${partnerAlias}! Start your Stage 1 conversation now.`
    : 'You have been paired with an Ally! Say hello in anonymous chat.';

  const descWithMeta = formatDescriptionWithMeta(plainDesc, {
    targetId: conversationId,
    groupKey,
    category,
    unreadCount: 1,
  });

  const insertPayload: Record<string, any> = {
    user_id: recipientId,
    type,
    title,
    description: descWithMeta,
    from_user_id: null,
    is_read: false,
    target_id: conversationId,
    group_key: groupKey,
    category,
    unread_count: 1,
  };

  let insertedId = '';
  const { data, error } = await supabaseAdmin.from('notifications').insert(insertPayload).select('id').maybeSingle();
  if (error) {
    const fallback = {
      user_id: recipientId,
      type,
      title,
      description: descWithMeta,
      is_read: false,
    };
    const res = await supabaseAdmin.from('notifications').insert(fallback).select('id').maybeSingle();
    insertedId = res.data?.id || '';
  } else {
    insertedId = data?.id || '';
  }

  const clientRow = buildClientPayload({
    id: insertedId,
    user_id: recipientId,
    type,
    title,
    description: plainDesc,
    is_read: false,
    target_id: conversationId,
    group_key: groupKey,
    category,
    unread_count: 1,
    created_at: new Date().toISOString(),
  });

  emitToUser(recipientId, 'notification:new', clientRow);

  try {
    const tokenMap = await getPushTokens([recipientId]);
    const pushToken = tokenMap.get(recipientId);
    if (pushToken) {
      const badge = await getUnreadBadgeCount(recipientId);
      const matchTag = `ally_match_${matchId}`;
      await sendExpoPushNotification({
        to: pushToken,
        sound: 'default',
        title,
        body: plainDesc,
        channelId: 'default',
        badge,
        tag: matchTag,
        collapseId: matchTag,
        threadId: matchTag,
        data: {
          conversationId,
          matchId,
          partnerAlias,
          groupKey,
          category: 'ally',
          type,
          tag: matchTag,
          collapseId: matchTag,
        },
      });
    }
  } catch (err) {
    console.warn('[dispatchAllyMatchedNotification] Push dispatch failed:', err);
  }
}

/**
 * 5. REMINDERS (Replaces existing reminder instead of stacking duplicates)
 */
export async function dispatchStreakReminderNotification(input: {
  recipientId: string;
  conversationId: string;
  title?: string;
  description?: string;
}): Promise<void> {
  const { recipientId, conversationId, title = 'Streak Reminder 🔥', description = 'Your streak is not yet activated! Send a message to keep it going.' } = input;
  const groupKey = `reminder:streak:${conversationId}`;
  const category: NotificationCategory = 'activity';
  const type = 'streak_reminder';

  // Check if an existing streak reminder for this conversation exists
  const existing = await notificationModel.findUnreadByGroupKey(recipientId, groupKey);

  const descWithMeta = formatDescriptionWithMeta(description, {
    targetId: conversationId,
    groupKey,
    category,
    unreadCount: 1,
  });

  if (existing) {
    // ── Overwrite existing reminder rather than creating a duplicate ──
    const updatePayload: Record<string, any> = {
      title,
      description: descWithMeta,
      is_read: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await notificationModel.updateNotification(existing.id, updatePayload);

    const clientRow = buildClientPayload({
      ...existing,
      ...updatePayload,
      description,
    });
    emitToUser(recipientId, 'notification:updated', clientRow);
  } else {
    const insertPayload: Record<string, any> = {
      user_id: recipientId,
      type,
      title,
      description: descWithMeta,
      is_read: false,
      target_id: conversationId,
      group_key: groupKey,
      category,
      unread_count: 1,
    };

    let insertedId = '';
    const { data, error } = await supabaseAdmin.from('notifications').insert(insertPayload).select('id').maybeSingle();
    if (error) {
      const fb = { user_id: recipientId, type, title, description: descWithMeta, is_read: false };
      const res = await supabaseAdmin.from('notifications').insert(fb).select('id').maybeSingle();
      insertedId = res.data?.id || '';
    } else {
      insertedId = data?.id || '';
    }

    const clientRow = buildClientPayload({
      id: insertedId,
      user_id: recipientId,
      type,
      title,
      description,
      is_read: false,
      target_id: conversationId,
      group_key: groupKey,
      category,
      unread_count: 1,
      created_at: new Date().toISOString(),
    });
    emitToUser(recipientId, 'notification:new', clientRow);
  }
}

/**
 * 6. SAFETY & EMERGENCY ALERTS (High-Priority push allowed)
 */
export async function dispatchSafetyAlertNotification(input: {
  recipientId: string;
  title: string;
  message: string;
  alertId?: string;
}): Promise<void> {
  const { recipientId, title, message, alertId } = input;
  const groupKey = `safety:${alertId || Date.now()}`;
  const category: NotificationCategory = 'safety';
  const type = 'admin_warning';

  const descWithMeta = formatDescriptionWithMeta(message, {
    targetId: alertId || null,
    groupKey,
    category,
    unreadCount: 1,
  });

  const insertPayload = {
    user_id: recipientId,
    type,
    title,
    description: descWithMeta,
    from_user_id: null,
    is_read: false,
    group_key: groupKey,
    category,
    unread_count: 1,
  };

  let insertedId = '';
  const { data, error } = await supabaseAdmin.from('notifications').insert(insertPayload).select('id').maybeSingle();
  if (error) {
    const fb = { user_id: recipientId, type, title, description: descWithMeta, is_read: false };
    const res = await supabaseAdmin.from('notifications').insert(fb).select('id').maybeSingle();
    insertedId = res.data?.id || '';
  } else {
    insertedId = data?.id || '';
  }

  const clientRow = buildClientPayload({
    id: insertedId,
    user_id: recipientId,
    type,
    title,
    description: message,
    is_read: false,
    group_key: groupKey,
    category,
    unread_count: 1,
    created_at: new Date().toISOString(),
  });

  emitToUser(recipientId, 'notification:new', clientRow);

  // High priority push notification
  try {
    const tokenMap = await getPushTokens([recipientId]);
    const pushToken = tokenMap.get(recipientId);
    if (pushToken) {
      const badge = await getUnreadBadgeCount(recipientId);
      await sendExpoPushNotification({
        to: pushToken,
        sound: 'default',
        title,
        body: message,
        priority: 'high',
        channelId: 'default',
        badge,
        data: { groupKey, category: 'safety', type },
      });
    }
  } catch (err) {
    console.warn('[dispatchSafetyAlertNotification] Push dispatch failed:', err);
  }
}

/**
 * 7. IN-APP NOTIFICATIONS ONLY (Reveal progress, points, stage progression, feed activity)
 * Strictly NEVER sends push notifications per specification.
 */
export async function dispatchActivityNotification(input: {
  recipientId: string;
  fromUserId?: string | null;
  type: string;
  title: string;
  description: string;
  targetId?: string | null;
  postId?: string | null;
  commentId?: string | null;
  parentId?: string | null;
  childId?: string | null;
  category?: NotificationCategory;
}): Promise<void> {
  const {
    recipientId,
    fromUserId,
    type,
    title,
    description,
    targetId,
    postId,
    commentId,
    parentId,
    childId,
    category = (type === 'accepted' || type.includes('stage') || type.includes('unlocked') ? 'ally' : 'activity') as NotificationCategory,
  } = input;

  const groupKey = postId ? `post:${postId}` : (targetId ? `activity:${targetId}` : `activity:${Date.now()}`);

  const descWithMeta = formatDescriptionWithMeta(description, {
    targetId: targetId || postId,
    groupKey,
    category,
    postId: postId || null,
    commentId: commentId || null,
    parentId: parentId || null,
    childId: childId || null,
    unreadCount: 1,
  });

  const insertPayload: Record<string, any> = {
    user_id: recipientId,
    type,
    title,
    description: descWithMeta,
    from_user_id: fromUserId ?? null,
    is_read: false,
    target_id: targetId || postId || null,
    post_id: postId || null,
    comment_id: commentId || null,
    group_key: groupKey,
    category,
    unread_count: 1,
  };

  let insertedId = '';
  const { data, error } = await supabaseAdmin.from('notifications').insert(insertPayload).select('id').maybeSingle();
  if (error) {
    const fb = {
      user_id: recipientId,
      type,
      title,
      description: descWithMeta,
      from_user_id: fromUserId ?? null,
      is_read: false,
      post_id: postId || null,
      comment_id: commentId || null,
    };
    const res = await supabaseAdmin.from('notifications').insert(fb).select('id').maybeSingle();
    insertedId = res.data?.id || '';
  } else {
    insertedId = data?.id || '';
  }

  const clientRow = buildClientPayload({
    id: insertedId,
    user_id: recipientId,
    type,
    title,
    description,
    from_user_id: fromUserId ?? null,
    is_read: false,
    target_id: targetId || postId || null,
    post_id: postId || null,
    comment_id: commentId || null,
    parent_id: parentId || null,
    child_id: childId || null,
    group_key: groupKey,
    category,
    unread_count: 1,
    created_at: new Date().toISOString(),
  });

  emitToUser(recipientId, 'notification:new', clientRow);
}

// ============================================================================
// Read Synchronization & Device Notification Tray Clearing
// ============================================================================

/**
 * Marks all notifications for a given conversation as read, synchronizing
 * across Web and Mobile, and signaling mobile to clear device tray notifications.
 */
export async function markConversationNotificationsRead(
  conversationId: string,
  userId: string
): Promise<void> {
  await notificationModel.markTargetRead(conversationId, userId);

  const remainingUnread = await getUnreadBadgeCount(userId);

  // Synchronize with all connected clients
  emitToUser(userId, 'notification:cleared', {
    conversationId,
    targetId: conversationId,
    category: 'messages',
    unreadCount: remainingUnread,
  });
  emitToUser(userId, 'notification:read', {
    targetId: conversationId,
    unreadCount: remainingUnread,
  });
}

/**
 * Marks connection request notifications as read and clears tray notifications.
 */
export async function markConnectionNotificationsRead(userId: string): Promise<void> {
  try {
    const { data: unread } = await supabaseAdmin
      .from('notifications')
      .select('id, type')
      .eq('user_id', userId)
      .eq('is_read', false)
      .in('type', ['friend_request', 'connection_request']);

    const ids = (unread || []).map((n) => n.id);
    if (ids.length > 0) {
      await supabaseAdmin.from('notifications').update({ is_read: true }).in('id', ids);
    }
  } catch (err) {
    console.warn('[markConnectionNotificationsRead] Error:', err);
  }

  const remainingUnread = await getUnreadBadgeCount(userId);

  emitToUser(userId, 'notification:cleared', {
    category: 'connections',
    unreadCount: remainingUnread,
  });
  emitToUser(userId, 'notification:read', {
    category: 'connections',
    unreadCount: remainingUnread,
  });
}

/**
 * Marks a single notification as read and synchronizes badge count.
 */
export async function markNotificationRead(notificationId: string, userId: string): Promise<void> {
  await notificationModel.markOneRead(notificationId, userId);
  const remainingUnread = await getUnreadBadgeCount(userId);

  emitToUser(userId, 'notification:read', {
    id: notificationId,
    unreadCount: remainingUnread,
  });
}

/**
 * Marks all notifications as read and synchronizes badge count.
 */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await notificationModel.markAllRead(userId);

  emitToUser(userId, 'notification:read_all', { unreadCount: 0 });
  emitToUser(userId, 'notification:cleared', { all: true, unreadCount: 0 });
}

/**
 * Deletes all notifications for a user.
 */
export async function clearAllNotifications(userId: string): Promise<void> {
  await notificationModel.deleteAll(userId);

  emitToUser(userId, 'notification:cleared', { all: true, unreadCount: 0 });
}
