import * as notificationModel from '../models/notification.model';
import type { NotificationRedirection, NotificationRow } from '../types/notification.types';

const DEFAULT_LIMIT = 20;

function computeNotificationRedirection(
  type: string,
  targetId: string | null,
  postId: string | null,
  commentId: string | null,
  fromUserId: string | null
): NotificationRedirection | null {
  // 1. Post likes & comments
  if (type === 'post_like' || type === 'post_comment' || type === 'like' || type === 'post' || type === 'feed') {
    const pId = postId || targetId;
    if (pId) {
      return {
        entityType: 'post',
        targetId: pId,
        route: '/pages/media-preview',
        params: { postId: pId, openComments: 'true' },
        webUrl: `/feed?postId=${pId}`,
      };
    }
  }

  // 2. Comments replies, likes, mentions
  if (type === 'comment_reply' || type === 'comment_like' || type === 'comment_mention' || type === 'comment') {
    const pId = postId || targetId;
    if (pId) {
      return {
        entityType: 'comment',
        targetId: commentId || pId,
        route: '/pages/media-preview',
        params: {
          postId: pId,
          openComments: 'true',
          ...(commentId ? { commentId } : {}),
        },
        webUrl: `/feed?postId=${pId}${commentId ? `&commentId=${commentId}` : ''}`,
      };
    }
  }

  // 3. Conversations, direct messages, anon matches, streak reminders
  if (type === 'message' || type === 'anon_match' || type === 'streak_reminder') {
    const convId = targetId || postId;
    if (convId) {
      return {
        entityType: 'conversation',
        targetId: convId,
        route: '/pages/conversation',
        params: { conversationId: convId },
        webUrl: `/messages?conversationId=${convId}`,
      };
    }
  }

  // 4. Connection requests accepted
  if (type === 'accepted' || type === 'connection_accepted') {
    const convId = targetId;
    if (convId) {
      return {
        entityType: 'conversation',
        targetId: convId,
        route: '/pages/conversation',
        params: { conversationId: convId },
        webUrl: `/messages?conversationId=${convId}`,
      };
    }
    const uId = fromUserId;
    if (uId) {
      return {
        entityType: 'profile',
        targetId: uId,
        route: '/pages/profile',
        params: { userId: uId },
        webUrl: `/profile/${uId}`,
      };
    }
  }

  // 5. Follows
  if (type === 'new_follower') {
    const uId = targetId || fromUserId;
    if (uId) {
      return {
        entityType: 'profile',
        targetId: uId,
        route: '/pages/profile',
        params: { userId: uId },
        webUrl: `/profile/${uId}`,
      };
    }
  }

  // 6. Incoming friend / ally requests
  if (type === 'friend_request' || type === 'connection_request') {
    const uId = targetId || fromUserId;
    return {
      entityType: 'requests',
      targetId: uId || '',
      route: '/pages/requests',
      params: uId ? { requesterId: uId } : {},
      webUrl: `/allies?tab=requests`,
    };
  }

  // 7. Matches
  if (type === 'match') {
    return {
      entityType: 'discover',
      targetId: '',
      route: '/(tabs)/discover',
      params: {},
      webUrl: `/discover`,
    };
  }

  return null;
}

function transformNotificationRow(row: NotificationRow): NotificationRow {
  let description = row.description ?? '';
  let postId = row.post_id ?? null;
  let commentId = row.comment_id ?? null;
  let targetId = row.target_id ?? null;

  if (description.startsWith('<!--meta:')) {
    const metaEndIndex = description.indexOf('-->');
    if (metaEndIndex !== -1) {
      try {
        const metaStr = description.slice(9, metaEndIndex);
        const meta = JSON.parse(metaStr);
        if (meta.postId) postId = meta.postId;
        if (meta.commentId) commentId = meta.commentId;
        if (meta.targetId) targetId = meta.targetId;
        description = description.slice(metaEndIndex + 3);
      } catch {
        // Fallback gracefully
      }
    }
  }

  const redirection = computeNotificationRedirection(
    row.type,
    targetId,
    postId,
    commentId,
    row.from_user_id ?? null
  );

  return {
    ...row,
    description,
    target_id: targetId,
    post_id: postId,
    comment_id: commentId,
    redirection,
  };
}

function consolidateNotifications(items: NotificationRow[]): NotificationRow[] {
  let seenAnonMatch = false;
  const result: NotificationRow[] = [];

  for (const item of items) {
    if (item.type === 'anon_match') {
      // Consolidate multiple anonymous match notifications into a single latest notification
      if (seenAnonMatch) {
        continue;
      }
      seenAnonMatch = true;
    }
    result.push(item);
  }

  return result;
}

/**
 * GET /notifications?limit=20
 */
export async function listNotifications(userId: string, limit?: number): Promise<NotificationRow[]> {
  const rows = await notificationModel.findByUser(userId, limit ?? DEFAULT_LIMIT);
  const transformed = rows.map(transformNotificationRow);
  return consolidateNotifications(transformed);
}

/**
 * GET /notifications/friend-requests
 */
export async function listFriendRequests(userId: string): Promise<NotificationRow[]> {
  const rows = await notificationModel.findFriendRequests(userId);
  return rows.map(transformNotificationRow);
}

/**
 * PATCH /notifications/:id/read
 */
export async function markRead(id: string, userId: string): Promise<void> {
  await notificationModel.markOneRead(id, userId);
}

/**
 * PATCH /notifications/read-all
 */
export async function markAllRead(userId: string): Promise<void> {
  await notificationModel.markAllRead(userId);
}

/**
 * DELETE /notifications
 */
export async function clearAllNotifications(userId: string): Promise<void> {
  await notificationModel.deleteAll(userId);
}
