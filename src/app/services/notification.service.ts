import * as notificationModel from '../models/notification.model';
import { supabaseAdmin } from '../../config/supabase';
import type {
  NotificationRedirection,
  NotificationRedirectionResponse,
  NotificationRedirectionTree,
  NotificationRow,
} from '../types/notification.types';
import { HttpError } from '../types/auth.types';

const DEFAULT_LIMIT = 20;

export function computeNotificationRedirection(
  type: string,
  targetId: string | null,
  postId: string | null,
  commentId: string | null,
  fromUserId: string | null,
  parentId?: string | null,
  childId?: string | null
): NotificationRedirection | null {
  const pId = postId || targetId || null;
  const cId = childId || commentId || null;
  const parId = parentId || null;

  // 1. Post likes & post comments
  if (type === 'post_like' || type === 'like' || type === 'post' || type === 'feed') {
    if (pId) {
      const tree: NotificationRedirectionTree = {
        postId: pId,
        parentId: null,
        childId: null,
        highlightId: pId,
      };
      return {
        entityType: 'post',
        targetId: pId,
        postId: pId,
        parentId: null,
        childId: null,
        route: '/pages/media-preview',
        params: { postId: pId },
        webUrl: `/post/${pId}?type=${type}`,
        tree,
      };
    }
  }

  // 2. Comments on post
  if (type === 'post_comment' || type === 'comment' || type === 'comment_mention') {
    if (pId) {
      const highlight = cId || pId;
      const tree: NotificationRedirectionTree = {
        postId: pId,
        parentId: parId,
        childId: cId,
        highlightId: highlight,
      };
      const queryParams = new URLSearchParams();
      if (cId) queryParams.set('commentId', cId);
      if (parId) queryParams.set('parentId', parId);
      queryParams.set('type', type);
      const qs = queryParams.toString();

      return {
        entityType: 'comment',
        targetId: cId || pId,
        postId: pId,
        parentId: parId,
        childId: cId,
        route: '/pages/media-preview',
        params: {
          postId: pId,
          openComments: 'true',
          ...(cId ? { commentId: cId } : {}),
          ...(parId ? { parentId: parId } : {}),
        },
        webUrl: `/post/${pId}${qs ? `?${qs}` : ''}`,
        tree,
      };
    }
  }

  // 3. Comments replies & comment likes
  if (type === 'comment_reply' || type === 'comment_like') {
    if (pId) {
      const highlight = cId || pId;
      const tree: NotificationRedirectionTree = {
        postId: pId,
        parentId: parId,
        childId: cId,
        highlightId: highlight,
      };
      const queryParams = new URLSearchParams();
      if (cId) queryParams.set('commentId', cId);
      if (parId) queryParams.set('parentId', parId);
      queryParams.set('type', type);
      const qs = queryParams.toString();

      return {
        entityType: type === 'comment_reply' ? 'reply' : 'comment',
        targetId: cId || pId,
        postId: pId,
        parentId: parId,
        childId: cId,
        route: '/pages/media-preview',
        params: {
          postId: pId,
          openComments: 'true',
          ...(cId ? { commentId: cId } : {}),
          ...(parId ? { parentId: parId } : {}),
        },
        webUrl: `/post/${pId}${qs ? `?${qs}` : ''}`,
        tree,
      };
    }
  }

  // 4. Conversations, direct messages, anon matches, streak reminders
  if (type === 'message' || type === 'anon_match' || type === 'streak_reminder') {
    const convId = targetId || pId;
    if (convId) {
      const tree: NotificationRedirectionTree = {
        postId: null,
        parentId: null,
        childId: convId,
        highlightId: convId,
      };
      return {
        entityType: 'conversation',
        targetId: convId,
        postId: null,
        parentId: null,
        childId: convId,
        route: '/pages/conversation',
        params: { conversationId: convId },
        webUrl: `/messages?conversationId=${convId}`,
        tree,
      };
    }
  }

  // 5. Connection requests accepted
  if (type === 'accepted' || type === 'connection_accepted') {
    const convId = targetId;
    if (convId) {
      const tree: NotificationRedirectionTree = {
        postId: null,
        parentId: null,
        childId: convId,
        highlightId: convId,
      };
      return {
        entityType: 'conversation',
        targetId: convId,
        postId: null,
        parentId: null,
        childId: convId,
        route: '/pages/conversation',
        params: { conversationId: convId },
        webUrl: `/messages?conversationId=${convId}`,
        tree,
      };
    }
    const uId = fromUserId;
    if (uId) {
      const tree: NotificationRedirectionTree = {
        postId: null,
        parentId: null,
        childId: uId,
        highlightId: uId,
      };
      return {
        entityType: 'profile',
        targetId: uId,
        postId: null,
        parentId: null,
        childId: uId,
        route: '/pages/profile',
        params: { userId: uId },
        webUrl: `/profile/${uId}`,
        tree,
      };
    }
  }

  // 6. Follows
  if (type === 'new_follower') {
    const uId = targetId || fromUserId;
    if (uId) {
      const tree: NotificationRedirectionTree = {
        postId: null,
        parentId: null,
        childId: uId,
        highlightId: uId,
      };
      return {
        entityType: 'profile',
        targetId: uId,
        postId: null,
        parentId: null,
        childId: uId,
        route: '/pages/profile',
        params: { userId: uId },
        webUrl: `/profile/${uId}`,
        tree,
      };
    }
  }

  // 7. Incoming friend / ally requests
  if (type === 'friend_request' || type === 'connection_request') {
    const uId = targetId || fromUserId;
    const tree: NotificationRedirectionTree = {
      postId: null,
      parentId: null,
      childId: uId || null,
      highlightId: uId || null,
    };
    return {
      entityType: 'requests',
      targetId: uId || '',
      postId: null,
      parentId: null,
      childId: uId || null,
      route: '/pages/requests',
      params: uId ? { requesterId: uId } : {},
      webUrl: `/requests`,
      tree,
    };
  }

  // 8. Matches
  if (type === 'match') {
    const tree: NotificationRedirectionTree = {
      postId: null,
      parentId: null,
      childId: null,
      highlightId: null,
    };
    return {
      entityType: 'discover',
      targetId: '',
      postId: null,
      parentId: null,
      childId: null,
      route: '/(tabs)/discover',
      params: {},
      webUrl: `/discover`,
      tree,
    };
  }

  return null;
}

function transformNotificationRow(row: NotificationRow): NotificationRow {
  let description = row.description ?? '';
  let postId = row.post_id ?? null;
  let commentId = row.comment_id ?? null;
  let parentId = row.parent_id ?? null;
  let childId = row.child_id ?? null;
  let targetId = row.target_id ?? null;

  const metaMatch = description.match(/<!--meta:(\{.*?\})-->/);
  if (metaMatch && metaMatch[1]) {
    try {
      const meta = JSON.parse(metaMatch[1]);
      if (meta.postId) postId = meta.postId;
      if (meta.commentId) commentId = meta.commentId;
      if (meta.parentId) parentId = meta.parentId;
      if (meta.childId) childId = meta.childId;
      if (meta.targetId) targetId = meta.targetId;
      description = description.replace(/<!--meta:\{.*?\}-->/, '').trim();
    } catch {
      // Fallback gracefully
    }
  }

  const redirection = computeNotificationRedirection(
    row.type,
    targetId,
    postId,
    commentId,
    row.from_user_id ?? null,
    parentId,
    childId
  );

  return {
    ...row,
    description,
    target_id: targetId,
    post_id: postId,
    comment_id: commentId,
    parent_id: parentId,
    child_id: childId,
    redirection,
  };
}

function consolidateNotifications(items: NotificationRow[]): NotificationRow[] {
  let seenAnonMatch = false;
  const result: NotificationRow[] = [];

  for (const item of items) {
    if (item.type === 'anon_match') {
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
 * GET /notifications/:id/redirection
 * Resolves accurate direct redirection and parent/child tree hierarchy.
 */
export async function resolveNotificationRedirection(
  notificationId: string,
  userId: string
): Promise<NotificationRedirectionResponse> {
  const notif = await notificationModel.findById(notificationId);
  if (!notif) {
    throw new HttpError('Notification not found', 404);
  }
  if (notif.user_id !== userId) {
    throw new HttpError('Forbidden', 403);
  }

  const transformed = transformNotificationRow(notif);
  let postId = transformed.post_id ?? null;
  let commentId = transformed.comment_id ?? null;
  let parentId = transformed.parent_id ?? null;
  let childId = transformed.child_id ?? null;

  // 1. If this notification involves a comment or reply, query post_comments to accurately build tree
  if (commentId) {
    try {
      const { data: commentData } = await supabaseAdmin
        .from('post_comments')
        .select('id, post_id, parent_comment_id')
        .eq('id', commentId)
        .maybeSingle();

      if (commentData) {
        postId = commentData.post_id || postId;
        if (commentData.parent_comment_id) {
          parentId = commentData.parent_comment_id;
          childId = commentData.id;
        } else {
          parentId = null;
          childId = commentData.id;
        }
      }
    } catch (err) {
      console.warn('[resolveNotificationRedirection] Error fetching comment details:', err);
    }
  }

  // 2. If postId is still null for a post/comment/like notification, dynamically resolve from DB
  const isPostRelated =
    transformed.type.includes('post') ||
    transformed.type.includes('comment') ||
    transformed.type.includes('like');

  if (!postId && isPostRelated) {
    try {
      if (transformed.type === 'post_like' || transformed.type === 'like') {
        if (notif.from_user_id) {
          const { data: like } = await supabaseAdmin
            .from('post_likes')
            .select('post_id, posts!inner(author_id)')
            .eq('user_id', notif.from_user_id)
            .eq('posts.author_id', notif.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (like?.post_id) postId = like.post_id;
        }
      } else if (transformed.type.includes('comment')) {
        if (notif.from_user_id) {
          const { data: cData } = await supabaseAdmin
            .from('post_comments')
            .select('id, post_id, parent_comment_id')
            .eq('author_id', notif.from_user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (cData) {
            postId = cData.post_id;
            commentId = cData.id;
            parentId = cData.parent_comment_id;
            childId = cData.id;
          }
        }
      }

      // Fallback: user's latest post
      if (!postId) {
        const { data: pData } = await supabaseAdmin
          .from('posts')
          .select('id')
          .eq('author_id', notif.user_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (pData?.id) postId = pData.id;
      }

      // Persist recovered IDs to DB in the background
      if (postId && !notif.post_id) {
        void Promise.resolve(
          supabaseAdmin
            .from('notifications')
            .update({ post_id: postId, ...(commentId ? { comment_id: commentId } : {}) })
            .eq('id', notif.id)
        ).catch(() => {});
      }
    } catch (err) {
      console.warn('[resolveNotificationRedirection] Fallback lookup error:', err);
    }
  }

  const redirection = computeNotificationRedirection(
    transformed.type,
    transformed.target_id ?? null,
    postId,
    commentId,
    transformed.from_user_id ?? null,
    parentId,
    childId
  );

  if (!redirection) {
    return {
      notificationId: notif.id,
      type: notif.type,
      entityType: 'post',
      targetId: postId || notif.id,
      webUrl: postId ? `/post/${postId}` : '/dashboard',
      route: postId ? '/pages/media-preview' : '/dashboard',
      params: postId ? { postId } : {},
      tree: {
        postId,
        parentId,
        childId,
        highlightId: childId || postId,
      },
    };
  }

  return {
    notificationId: notif.id,
    type: notif.type,
    entityType: redirection.entityType,
    targetId: redirection.targetId,
    webUrl: redirection.webUrl,
    route: redirection.route,
    params: redirection.params || {},
    tree: redirection.tree || {
      postId,
      parentId,
      childId,
      highlightId: childId || postId,
    },
  };
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
