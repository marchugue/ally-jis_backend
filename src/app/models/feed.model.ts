import { supabaseAdmin } from '../../config/supabase';
import type { CommentRow, PostAudience, PostMediaRow, PostRow } from '../types/feed.types';

const PROFILE_SELECT = 'id, username, full_name, avatar_url';
const POST_COLUMNS = 'id, author_id, content, audience, likes_count, comments_count, created_at, updated_at';
const COMMENT_COLUMNS =
  'id, post_id, author_id, parent_comment_id, content, likes_count, created_at, updated_at';
const POST_MEDIA_COLUMNS = 'id, post_id, url, position, created_at';

/**
 * Mirrors can_view_post() in schema.sql: the author can always see their
 * own post, public posts are visible to everyone, and connections-only
 * posts require an accepted interaction in either direction.
 */
export async function canViewPost(viewerId: string, authorId: string, audience: PostAudience): Promise<boolean> {
  if (viewerId === authorId) return true;
  if (audience === 'public') return true;

  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select('status')
    .eq('status', 'accepted')
    .or(
      `and(user_id.eq.${viewerId},target_user_id.eq.${authorId}),and(user_id.eq.${authorId},target_user_id.eq.${viewerId})`
    )
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * GET /feed
 * Pulls a page of candidate posts (most recent first, optionally before a
 * cursor), then the service layer filters by visibility. We over-fetch
 * slightly isn't needed here since visibility is cheap to check in bulk
 * via the accepted-connections set — see feed.service.ts.
 */
export async function findFeedCandidates(limit: number, before?: string): Promise<PostRow[]> {
  let query = supabaseAdmin
    .from('posts')
    .select(POST_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as PostRow[]) ?? [];
}

/**
 * Returns the set of user ids the given user has an accepted connection
 * with (either direction), used to bulk-filter connections-only posts
 * without an N+1 of canViewPost calls per feed page.
 */
export async function findAcceptedConnectionIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select('user_id, target_user_id')
    .eq('status', 'accepted')
    .or(`user_id.eq.${userId},target_user_id.eq.${userId}`);

  if (error) throw error;

  const ids = new Set<string>();
  for (const row of (data as { user_id: string; target_user_id: string }[]) ?? []) {
    ids.add(row.user_id === userId ? row.target_user_id : row.user_id);
  }
  return ids;
}

/**
 * GET /feed/users/:userId — posts authored by a single user, still subject
 * to the same visibility rule applied by the service layer.
 */
export async function findPostsByAuthor(authorId: string, limit: number, before?: string): Promise<PostRow[]> {
  let query = supabaseAdmin
    .from('posts')
    .select(POST_COLUMNS)
    .eq('author_id', authorId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as PostRow[]) ?? [];
}

export async function findPostById(postId: string): Promise<PostRow | null> {
  const { data, error } = await supabaseAdmin.from('posts').select(POST_COLUMNS).eq('id', postId).maybeSingle();

  if (error) throw error;
  return (data as PostRow | null) ?? null;
}

export async function findProfilesByIds(
  ids: string[]
): Promise<Map<string, { id: string; username: string | null; full_name: string | null; avatar_url: string | null }>> {
  if (ids.length === 0) return new Map();

  const { data, error } = await supabaseAdmin.from('profiles').select(PROFILE_SELECT).in('id', ids);
  if (error) throw error;

  const map = new Map<string, { id: string; username: string | null; full_name: string | null; avatar_url: string | null }>();
  for (const row of data ?? []) {
    map.set(row.id, row as { id: string; username: string | null; full_name: string | null; avatar_url: string | null });
  }
  return map;
}

export async function findLikedPostIds(userId: string, postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();

  const { data, error } = await supabaseAdmin
    .from('post_likes')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.post_id as string));
}

export async function findLikedCommentIds(userId: string, commentIds: string[]): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set();

  const { data, error } = await supabaseAdmin
    .from('comment_likes')
    .select('comment_id')
    .eq('user_id', userId)
    .in('comment_id', commentIds);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.comment_id as string));
}

/**
 * Returns a map of post_id -> ordered media rows (by `position`), for a
 * batch of posts. Used by the service layer's hydratePosts() so the feed
 * doesn't do an N+1 media fetch per post.
 */
export async function findMediaForPosts(postIds: string[]): Promise<Map<string, PostMediaRow[]>> {
  if (postIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('post_media')
    .select(POST_MEDIA_COLUMNS)
    .in('post_id', postIds)
    .order('position', { ascending: true });

  if (error) throw error;

  const map = new Map<string, PostMediaRow[]>();
  for (const row of (data as PostMediaRow[]) ?? []) {
    const bucket = map.get(row.post_id) ?? [];
    bucket.push(row);
    map.set(row.post_id, bucket);
  }
  return map;
}

export async function insertPost(input: {
  authorId: string;
  content: string;
  audience: PostAudience;
}): Promise<PostRow> {
  const { data, error } = await supabaseAdmin
    .from('posts')
    .insert({ author_id: input.authorId, content: input.content, audience: input.audience })
    .select(POST_COLUMNS)
    .single();

  if (error) throw error;
  return data as PostRow;
}

/**
 * Inserts post_media rows for a freshly created post. `urls` is assumed
 * to already be validated (max 4, already uploaded via POST /media/posts)
 * by the service layer — position is just the array index.
 */
export async function insertPostMedia(postId: string, urls: string[]): Promise<PostMediaRow[]> {
  if (urls.length === 0) return [];

  const rows = urls.map((url, position) => ({ post_id: postId, url, position }));

  const { data, error } = await supabaseAdmin.from('post_media').insert(rows).select(POST_MEDIA_COLUMNS);

  if (error) throw error;
  return (data as PostMediaRow[]) ?? [];
}

export async function updatePost(
  postId: string,
  updates: { content?: string; audience?: PostAudience }
): Promise<PostRow> {
  const { data, error } = await supabaseAdmin
    .from('posts')
    .update(updates)
    .eq('id', postId)
    .select(POST_COLUMNS)
    .single();

  if (error) throw error;
  return data as PostRow;
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('posts').delete().eq('id', postId);
  if (error) throw error;
}

export async function likePost(postId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('post_likes')
    .upsert({ post_id: postId, user_id: userId }, { onConflict: 'post_id,user_id', ignoreDuplicates: true });

  if (error) throw error;
}

export async function unlikePost(postId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId);
  if (error) throw error;
}

export async function isPostLikedByUser(postId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('post_likes')
    .select('id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export async function getPostLikesCount(postId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.from('posts').select('likes_count').eq('id', postId).single();
  if (error) throw error;
  return (data as { likes_count: number }).likes_count;
}

/**
 * GET /feed/posts/:postId/comments
 * Top-level comments only; replies are fetched separately and nested by
 * the service layer (one level deep, per schema.sql's enforce_single_level_reply).
 */
export async function findTopLevelComments(postId: string, limit: number, before?: string): Promise<CommentRow[]> {
  let query = supabaseAdmin
    .from('post_comments')
    .select(COMMENT_COLUMNS)
    .eq('post_id', postId)
    .is('parent_comment_id', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as CommentRow[]) ?? [];
}

export async function findRepliesForComments(parentCommentIds: string[]): Promise<CommentRow[]> {
  if (parentCommentIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('post_comments')
    .select(COMMENT_COLUMNS)
    .in('parent_comment_id', parentCommentIds)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data as CommentRow[]) ?? [];
}

export async function findCommentById(commentId: string): Promise<CommentRow | null> {
  const { data, error } = await supabaseAdmin
    .from('post_comments')
    .select(COMMENT_COLUMNS)
    .eq('id', commentId)
    .maybeSingle();

  if (error) throw error;
  return (data as CommentRow | null) ?? null;
}

export async function insertComment(input: {
  postId: string;
  authorId: string;
  content: string;
  parentCommentId: string | null;
}): Promise<CommentRow> {
  const { data, error } = await supabaseAdmin
    .from('post_comments')
    .insert({
      post_id: input.postId,
      author_id: input.authorId,
      content: input.content,
      parent_comment_id: input.parentCommentId,
    })
    .select(COMMENT_COLUMNS)
    .single();

  if (error) throw error;
  return data as CommentRow;
}

export async function updateComment(commentId: string, content: string): Promise<CommentRow> {
  const { data, error } = await supabaseAdmin
    .from('post_comments')
    .update({ content })
    .eq('id', commentId)
    .select(COMMENT_COLUMNS)
    .single();

  if (error) throw error;
  return data as CommentRow;
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('post_comments').delete().eq('id', commentId);
  if (error) throw error;
}

export async function likeComment(commentId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('comment_likes')
    .upsert({ comment_id: commentId, user_id: userId }, { onConflict: 'comment_id,user_id', ignoreDuplicates: true });

  if (error) throw error;
}

export async function unlikeComment(commentId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('comment_likes')
    .delete()
    .eq('comment_id', commentId)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function isCommentLikedByUser(commentId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('comment_likes')
    .select('id')
    .eq('comment_id', commentId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export async function getCommentLikesCount(commentId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('post_comments')
    .select('likes_count')
    .eq('id', commentId)
    .single();

  if (error) throw error;
  return (data as { likes_count: number }).likes_count;
}

/**
 * Shared by like/comment notification flows in feed.service.ts.
 */
export async function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  description: string;
  fromUserId: string;
}): Promise<void> {
  const { userId, type, title, description, fromUserId } = input;

  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    type,
    title,
    description,
    from_user_id: fromUserId,
  });

  if (error) throw error;
}