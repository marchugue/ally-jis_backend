import * as feedModel from '../models/feed.model';
import { HttpError } from '../types/auth.types';
import type {
  CommentRow,
  CommentWithAuthor,
  LikeStatusResponse,
  PostAudience,
  PostRow,
  PostWithAuthor,
} from '../types/feed.types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_POST_IMAGES = 4;

function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(limit, MAX_PAGE_SIZE));
}

/**
 * Attaches author profile info + "did the current viewer like this" flags
 * + ordered media to a batch of posts. Shared by listFeed / listPostsByAuthor
 * / getPostById / createPost so we only write the join-by-hand logic once.
 */
async function hydratePosts(viewerId: string, posts: PostRow[]): Promise<PostWithAuthor[]> {
  if (posts.length === 0) return [];

  const authorIds = [...new Set(posts.map((p) => p.author_id))];
  const postIds = posts.map((p) => p.id);
  const [profileMap, likedIds, mediaMap] = await Promise.all([
    feedModel.findProfilesByIds(authorIds),
    feedModel.findLikedPostIds(viewerId, postIds),
    feedModel.findMediaForPosts(postIds),
  ]);

  return posts.map((post) => ({
    ...post,
    author: profileMap.get(post.author_id) ?? null,
    liked_by_me: likedIds.has(post.id),
    media: mediaMap.get(post.id) ?? [],
  }));
}

async function hydrateComments(viewerId: string, comments: CommentRow[]): Promise<CommentWithAuthor[]> {
  if (comments.length === 0) return [];

  const authorIds = [...new Set(comments.map((c) => c.author_id))];
  const [profileMap, likedIds] = await Promise.all([
    feedModel.findProfilesByIds(authorIds),
    feedModel.findLikedCommentIds(viewerId, comments.map((c) => c.id)),
  ]);

  return comments.map((comment) => ({
    ...comment,
    author: profileMap.get(comment.author_id) ?? null,
    liked_by_me: likedIds.has(comment.id),
  }));
}

/**
 * GET /feed
 * Fetches a page of candidate posts ordered by recency, then drops any
 * connections-only post the viewer isn't allowed to see. Because we filter
 * after fetching, a page can come back smaller than `limit` if the viewer
 * is blocked from some posts — acceptable tradeoff for avoiding N+1
 * visibility checks; the accepted-connections set is fetched once per call.
 */
export async function listFeed(
  viewerId: string,
  options: { limit?: number; before?: string }
): Promise<PostWithAuthor[]> {
   
  try {                                                    // ← add
    const limit = clampLimit(options.limit);
    const candidates = await feedModel.findFeedCandidates(limit, options.before);
    const connectionIds = await feedModel.findAcceptedConnectionIds(viewerId);
    const visible = candidates.filter(
      (post) => post.author_id === viewerId || post.audience === 'public' || connectionIds.has(post.author_id)
    );
    return hydratePosts(viewerId, visible);
  } catch (err) {
    console.log('listFeed called, viewerId:', viewerId);                                          // ← add
    console.error('listFeed error:', err);                 // ← add
    throw err;                                             // ← add
  }                                                        // ← add
}

/**
 * GET /feed/users/:userId
 */
export async function listPostsByAuthor(
  viewerId: string,
  authorId: string,
  options: { limit?: number; before?: string }
): Promise<PostWithAuthor[]> {
  const limit = clampLimit(options.limit);
  const candidates = await feedModel.findPostsByAuthor(authorId, limit, options.before);

  const canSeeConnectionsPosts =
    viewerId === authorId || (await feedModel.canViewPost(viewerId, authorId, 'connections'));

  const visible = candidates.filter((post) => post.audience === 'public' || canSeeConnectionsPosts);

  return hydratePosts(viewerId, visible);
}

/**
 * GET /feed/posts/:postId
 */
export async function getPostById(viewerId: string, postId: string): Promise<PostWithAuthor> {
  const post = await feedModel.findPostById(postId);
  if (!post) {
    throw new HttpError('Post not found', 404);
  }

  const visible = await feedModel.canViewPost(viewerId, post.author_id, post.audience);
  if (!visible) {
    throw new HttpError('You do not have permission to view this post', 403);
  }

  const [hydrated] = await hydratePosts(viewerId, [post]);
  return hydrated;
}

/**
 * POST /feed/posts
 * `mediaUrls` are public URLs already uploaded via POST /media/posts —
 * this endpoint just persists the post_media rows that reference them.
 * Max 4 is enforced here as a clean 400 instead of relying solely on the
 * DB trigger/constraint in post_media_migration.sql.
 */
export async function createPost(
  authorId: string,
  input: { content: string; audience?: PostAudience; mediaUrls?: string[] }
): Promise<PostWithAuthor> {
  const content = input.content?.trim() ?? '';
  const mediaUrls = input.mediaUrls ?? [];

  if (!content && mediaUrls.length === 0) {
    throw new HttpError('Post must include text or at least one image', 400);
  }

  if (mediaUrls.length > MAX_POST_IMAGES) {
    throw new HttpError(`A post can have at most ${MAX_POST_IMAGES} images`, 400);
  }

  const audience: PostAudience = input.audience === 'connections' ? 'connections' : 'public';

  const post = await feedModel.insertPost({ authorId, content, audience });

  if (mediaUrls.length > 0) {
    await feedModel.insertPostMedia(post.id, mediaUrls);
  }

  const [hydrated] = await hydratePosts(authorId, [post]);
  return hydrated;
}

/**
 * PATCH /feed/posts/:postId
 * Only the author can edit. Throws 404 before 403 so a non-existent post
 * doesn't leak "you don't own this" vs "doesn't exist" distinctions.
 *
 * Note: media is intentionally not editable here — delete and recreate
 * the post if the images need to change. Keeps this endpoint's contract
 * simple and matches how most social apps treat post media as immutable.
 */
export async function updatePost(
  userId: string,
  postId: string,
  updates: { content?: string; audience?: PostAudience }
): Promise<PostWithAuthor> {
  const existing = await feedModel.findPostById(postId);
  if (!existing) {
    throw new HttpError('Post not found', 404);
  }
  if (existing.author_id !== userId) {
    throw new HttpError('You can only edit your own posts', 403);
  }

  const patch: { content?: string; audience?: PostAudience } = {};
  if (updates.content !== undefined) {
    const trimmed = updates.content.trim();
    if (!trimmed) {
      throw new HttpError('Post content cannot be empty', 400);
    }
    patch.content = trimmed;
  }
  if (updates.audience !== undefined) {
    patch.audience = updates.audience;
  }

  const updated = await feedModel.updatePost(postId, patch);
  const [hydrated] = await hydratePosts(userId, [updated]);
  return hydrated;
}

/**
 * DELETE /feed/posts/:postId
 * post_media rows cascade-delete at the DB level (on delete cascade on
 * post_id), so no explicit cleanup is needed here. Storage objects in the
 * post-media bucket are left in place — add a cleanup job later if
 * orphaned files become a storage-cost concern.
 */
export async function deletePost(userId: string, postId: string): Promise<void> {
  const existing = await feedModel.findPostById(postId);
  if (!existing) {
    throw new HttpError('Post not found', 404);
  }
  if (existing.author_id !== userId) {
    throw new HttpError('You can only delete your own posts', 403);
  }

  await feedModel.deletePost(postId);
}

/**
 * POST /feed/posts/:postId/like
 * Idempotent: liking an already-liked post is a no-op (upsert with
 * ignoreDuplicates), so double-taps from the client can't double count.
 */
export async function likePost(userId: string, postId: string): Promise<LikeStatusResponse> {
  const post = await feedModel.findPostById(postId);
  if (!post) {
    throw new HttpError('Post not found', 404);
  }

  const visible = await feedModel.canViewPost(userId, post.author_id, post.audience);
  if (!visible) {
    throw new HttpError('You do not have permission to view this post', 403);
  }

  await feedModel.likePost(postId, userId);

  if (post.author_id !== userId) {
    await feedModel.createNotification({
      userId: post.author_id,
      type: 'post_like',
      title: 'New like on your post',
      description: 'Someone liked your post.',
      fromUserId: userId,
    });
  }

  const likesCount = await feedModel.getPostLikesCount(postId);
  return { liked: true, likesCount };
}

/**
 * DELETE /feed/posts/:postId/like
 */
export async function unlikePost(userId: string, postId: string): Promise<LikeStatusResponse> {
  const post = await feedModel.findPostById(postId);
  if (!post) {
    throw new HttpError('Post not found', 404);
  }

  await feedModel.unlikePost(postId, userId);

  const likesCount = await feedModel.getPostLikesCount(postId);
  return { liked: false, likesCount };
}

/**
 * GET /feed/posts/:postId/comments
 * Returns top-level comments newest-first, each with its replies nested
 * (oldest-first within a thread, matching natural reading order).
 */
export async function listComments(
  viewerId: string,
  postId: string,
  options: { limit?: number; before?: string }
): Promise<(CommentWithAuthor & { replies: CommentWithAuthor[] })[]> {
  const post = await feedModel.findPostById(postId);
  if (!post) {
    throw new HttpError('Post not found', 404);
  }

  const visible = await feedModel.canViewPost(viewerId, post.author_id, post.audience);
  if (!visible) {
    throw new HttpError('You do not have permission to view this post', 403);
  }

  const limit = clampLimit(options.limit);
  const topLevel = await feedModel.findTopLevelComments(postId, limit, options.before);
  const replies = await feedModel.findRepliesForComments(topLevel.map((c) => c.id));

  const [hydratedTopLevel, hydratedReplies] = await Promise.all([
    hydrateComments(viewerId, topLevel),
    hydrateComments(viewerId, replies),
  ]);

  const repliesByParent = new Map<string, CommentWithAuthor[]>();
  for (const reply of hydratedReplies) {
    const parentId = reply.parent_comment_id as string;
    const bucket = repliesByParent.get(parentId) ?? [];
    bucket.push(reply);
    repliesByParent.set(parentId, bucket);
  }

  return hydratedTopLevel.map((comment) => ({
    ...comment,
    replies: repliesByParent.get(comment.id) ?? [],
  }));
}

/**
 * POST /feed/posts/:postId/comments
 * Mirrors enforce_single_level_reply() in schema.sql by checking the
 * parent's own parent before insert, so the client gets a clean 400
 * instead of a raw Postgres trigger exception.
 */
export async function createComment(
  authorId: string,
  postId: string,
  input: { content: string; parentCommentId?: string | null }
): Promise<CommentWithAuthor> {
  const content = input.content?.trim();
  if (!content) {
    throw new HttpError('Comment content cannot be empty', 400);
  }

  const post = await feedModel.findPostById(postId);
  if (!post) {
    throw new HttpError('Post not found', 404);
  }

  const visible = await feedModel.canViewPost(authorId, post.author_id, post.audience);
  if (!visible) {
    throw new HttpError('You do not have permission to comment on this post', 403);
  }

  let parentCommentId: string | null = null;
  if (input.parentCommentId) {
    const parent = await feedModel.findCommentById(input.parentCommentId);
    if (!parent || parent.post_id !== postId) {
      throw new HttpError('Parent comment not found on this post', 404);
    }
    if (parent.parent_comment_id) {
      throw new HttpError('Replies can only be one level deep', 400);
    }
    parentCommentId = parent.id;
  }

  const comment = await feedModel.insertComment({ postId, authorId, content, parentCommentId });

  // Notify the post author (unless commenting on your own post).
  if (post.author_id !== authorId) {
    await feedModel.createNotification({
      userId: post.author_id,
      type: 'post_comment',
      title: 'New comment on your post',
      description: 'Someone commented on your post.',
      fromUserId: authorId,
    });
  }

  // Replies also notify the parent comment's author.
  if (parentCommentId) {
    const parent = await feedModel.findCommentById(parentCommentId);
    if (parent && parent.author_id !== authorId) {
      await feedModel.createNotification({
        userId: parent.author_id,
        type: 'comment_reply',
        title: 'New reply to your comment',
        description: 'Someone replied to your comment.',
        fromUserId: authorId,
      });
    }
  }

  const [hydrated] = await hydrateComments(authorId, [comment]);
  return hydrated;
}

/**
 * PATCH /feed/comments/:commentId
 */
export async function updateComment(userId: string, commentId: string, content: string): Promise<CommentWithAuthor> {
  const existing = await feedModel.findCommentById(commentId);
  if (!existing) {
    throw new HttpError('Comment not found', 404);
  }
  if (existing.author_id !== userId) {
    throw new HttpError('You can only edit your own comments', 403);
  }

  const trimmed = content?.trim();
  if (!trimmed) {
    throw new HttpError('Comment content cannot be empty', 400);
  }

  const updated = await feedModel.updateComment(commentId, trimmed);
  const [hydrated] = await hydrateComments(userId, [updated]);
  return hydrated;
}

/**
 * DELETE /feed/comments/:commentId
 * Either the comment's author OR the post's author can delete it (the
 * latter so people can moderate their own posts), matching common social
 * app behavior. Replies cascade-delete at the DB level.
 */
export async function deleteComment(userId: string, commentId: string): Promise<void> {
  const existing = await feedModel.findCommentById(commentId);
  if (!existing) {
    throw new HttpError('Comment not found', 404);
  }

  if (existing.author_id !== userId) {
    const post = await feedModel.findPostById(existing.post_id);
    if (!post || post.author_id !== userId) {
      throw new HttpError('You can only delete your own comments', 403);
    }
  }

  await feedModel.deleteComment(commentId);
}

/**
 * POST /feed/comments/:commentId/like
 */
export async function likeComment(userId: string, commentId: string): Promise<LikeStatusResponse> {
  const comment = await feedModel.findCommentById(commentId);
  if (!comment) {
    throw new HttpError('Comment not found', 404);
  }

  const post = await feedModel.findPostById(comment.post_id);
  if (!post) {
    throw new HttpError('Post not found', 404);
  }

  const visible = await feedModel.canViewPost(userId, post.author_id, post.audience);
  if (!visible) {
    throw new HttpError('You do not have permission to view this comment', 403);
  }

  await feedModel.likeComment(commentId, userId);

  if (comment.author_id !== userId) {
    await feedModel.createNotification({
      userId: comment.author_id,
      type: 'comment_like',
      title: 'New like on your comment',
      description: 'Someone liked your comment.',
      fromUserId: userId,
    });
  }

  const likesCount = await feedModel.getCommentLikesCount(commentId);
  return { liked: true, likesCount };
}

/**
 * DELETE /feed/comments/:commentId/like
 */
export async function unlikeComment(userId: string, commentId: string): Promise<LikeStatusResponse> {
  const comment = await feedModel.findCommentById(commentId);
  if (!comment) {
    throw new HttpError('Comment not found', 404);
  }

  await feedModel.unlikeComment(commentId, userId);

  const likesCount = await feedModel.getCommentLikesCount(commentId);
  return { liked: false, likesCount };
}