import * as feedModel from '../models/feed.model';
import * as profileModel from '../models/profile.model';
import * as followModel from '../models/follow.model';
import { HttpError } from '../types/auth.types';
import { getDeterministicAnonymousAvatar } from '../constants/anonymousIdentity';
import type {
  AuthorSummary,
  CommentRow,
  CommentWithAuthor,
  FeedFilterOptions,
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
 *
 * FULL ANONYMITY: If the author is not an ally of the viewer (and not the
 * viewer themselves), all real identity attributes are masked as 'Anonymous Peer'
 * with a deterministic animal avatar.
 */
async function hydratePosts(viewerId: string, posts: PostRow[]): Promise<PostWithAuthor[]> {
  if (posts.length === 0) return [];

  const authorIds = [...new Set(posts.map((p) => p.author_id))];
  const postIds = posts.map((p) => p.id);
  const [profileMap, likedIds, mediaMap, followingIds, connectionIds] = await Promise.all([
    feedModel.findProfilesByIds(authorIds),
    feedModel.findLikedPostIds(viewerId, postIds),
    feedModel.findMediaForPosts(postIds),
    followModel.getFollowingIds(viewerId),
    feedModel.findAcceptedConnectionIds(viewerId),
  ]);

  return posts.map((post) => {
    const rawAuthor = profileMap.get(post.author_id);
    const isOwn = viewerId === post.author_id;
    const isAlly = isOwn || connectionIds.has(post.author_id);

    let author: AuthorSummary | null = null;
    if (rawAuthor) {
      if (isAlly) {
        author = {
          ...rawAuthor,
          is_following: isOwn ? false : followingIds.has(post.author_id),
          is_ally: true,
          avatarKey: null,
        };
      } else {
        author = {
          id: rawAuthor.id,
          full_name: 'Anonymous Peer',
          username: 'anonymous',
          avatar_url: null,
          avatarKey: getDeterministicAnonymousAvatar(rawAuthor.id),
          department: null,
          course: null,
          interests: null,
          is_following: false,
          is_ally: false,
        };
      }
    }

    return {
      ...post,
      author,
      liked_by_me: likedIds.has(post.id),
      media: mediaMap.get(post.id) ?? [],
    };
  });
}

async function hydrateComments(viewerId: string, comments: CommentRow[]): Promise<CommentWithAuthor[]> {
  if (comments.length === 0) return [];

  const authorIds = [...new Set(comments.map((c) => c.author_id))];
  const [profileMap, likedIds, connectionIds] = await Promise.all([
    feedModel.findProfilesByIds(authorIds),
    feedModel.findLikedCommentIds(viewerId, comments.map((c) => c.id)),
    feedModel.findAcceptedConnectionIds(viewerId),
  ]);

  return comments.map((comment) => {
    const rawAuthor = profileMap.get(comment.author_id);
    const isOwn = viewerId === comment.author_id;
    const isAlly = isOwn || connectionIds.has(comment.author_id);

    let author: AuthorSummary | null = null;
    if (rawAuthor) {
      if (isAlly) {
        author = {
          ...rawAuthor,
          is_ally: true,
          avatarKey: null,
        };
      } else {
        author = {
          id: rawAuthor.id,
          full_name: 'Anonymous Peer',
          username: 'anonymous',
          avatar_url: null,
          avatarKey: getDeterministicAnonymousAvatar(rawAuthor.id),
          is_ally: false,
        };
      }
    }

    return {
      ...comment,
      author,
      liked_by_me: likedIds.has(comment.id),
    };
  });
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
  options: FeedFilterOptions = {}
): Promise<PostWithAuthor[]> {
  try {
    const limit = clampLimit(options.limit);
    const filterType = options.filter || 'all';

    // If discover or popular filter is selected, fetch a larger pool to score & rank
    const candidatePoolSize =
      filterType === 'discover' || filterType === 'popular'
        ? Math.max(limit * 3, 60)
        : Math.max(limit * 2, 40);

    const candidates = await feedModel.findFeedCandidates(candidatePoolSize, options.before);
    const connectionIds = await feedModel.findAcceptedConnectionIds(viewerId);

    // 1. Initial visibility filtering (author itself, public, or accepted connection)
    const visible = candidates.filter(
      (post) => post.author_id === viewerId || post.audience === 'public' || connectionIds.has(post.author_id)
    );

    // 2. Hydrate posts with authors & media
    let hydrated = await hydratePosts(viewerId, visible);

    // 3. Social graph filtering (allies or following)
    if (filterType === 'allies') {
      hydrated = hydrated.filter((post) => post.author_id === viewerId || connectionIds.has(post.author_id));
    } else if (filterType === 'following') {
      hydrated = hydrated.filter((post) => post.author_id === viewerId || Boolean(post.author?.is_following));
    }

    // 4. Attribute filters
    if (options.department) {
      const dept = options.department.toLowerCase().trim();
      hydrated = hydrated.filter((post) => post.author?.department?.toLowerCase().trim() === dept);
    }

    if (options.course) {
      const course = options.course.toLowerCase().trim();
      hydrated = hydrated.filter((post) => post.author?.course?.toLowerCase().trim() === course);
    }

    if (options.interest) {
      const targetInterest = options.interest.toLowerCase().trim();
      hydrated = hydrated.filter((post) => {
        const authorInterests = (post.author?.interests || []).map((i) => i.toLowerCase().trim());
        const postText = post.content.toLowerCase();
        return authorInterests.includes(targetInterest) || postText.includes(targetInterest);
      });
    }

    if (options.search) {
      const q = options.search.toLowerCase().trim();
      hydrated = hydrated.filter((post) => {
        return (
          post.content.toLowerCase().includes(q) ||
          post.author?.full_name?.toLowerCase().includes(q) ||
          post.author?.username?.toLowerCase().includes(q)
        );
      });
    }

    if (options.mediaOnly) {
      hydrated = hydrated.filter((post) => post.media && post.media.length > 0);
    }

    // 5. Discover / Popular Algorithm:
    // "i want the discover newsfeed algorithm is, the interest of the user relevant and more followers or popularity based"
    if (filterType === 'discover' || filterType === 'popular') {
      const viewerProfile = await profileModel.findById(viewerId);

      const viewerInterests = new Set(
        (viewerProfile?.interests ?? []).map((i) => i.toLowerCase().trim())
      );
      const viewerDept = viewerProfile?.department?.toLowerCase().trim();
      const viewerCourse = viewerProfile?.course?.toLowerCase().trim();

      // Batch get author follower counts for author popularity
      const authorIds = [...new Set(hydrated.map((p) => p.author_id))];
      const followerCounts = await Promise.all(
        authorIds.map(async (authorId) => {
          const { followersCount } = await followModel.getCounts(authorId).catch(() => ({ followersCount: 0 }));
          return [authorId, followersCount] as const;
        })
      );
      const followerCountMap = new Map(followerCounts);

      const scoredPosts = hydrated.map((post) => {
        let interestScore = 0;
        let popularityScore = 0;
        let affinityScore = 0;

        // A. Interest Relevance Score (0 - 50 pts)
        const postContentLower = (post.content || '').toLowerCase();
        for (const interest of viewerInterests) {
          if (interest.length > 2 && postContentLower.includes(interest)) {
            interestScore += 12;
          }
        }

        if (post.author?.interests && Array.isArray(post.author.interests)) {
          for (const authorInterest of post.author.interests) {
            if (viewerInterests.has(authorInterest.toLowerCase().trim())) {
              interestScore += 10;
            }
          }
        }
        interestScore = Math.min(50, interestScore);

        if (viewerDept && post.author?.department?.toLowerCase().trim() === viewerDept) {
          interestScore += 6;
        }
        if (viewerCourse && post.author?.course?.toLowerCase().trim() === viewerCourse) {
          interestScore += 4;
        }

        // B. Popularity Score (0 - 45 pts)
        const likes = post.likes_count || 0;
        const comments = post.comments_count || 0;
        const engagement = Math.min(25, likes * 2 + comments * 3.5);

        const authorFollowers = followerCountMap.get(post.author_id) || 0;
        const followerBoost = Math.min(20, Math.log10(authorFollowers + 1) * 8);

        popularityScore = engagement + followerBoost;

        // C. Social Affinity (0 - 15 pts)
        if (post.author?.is_following) affinityScore += 8;
        if (connectionIds.has(post.author_id)) affinityScore += 12;

        // D. Time Decay Multiplier (half-life of ~36 hours)
        const postTime = new Date(post.created_at).getTime();
        const ageHours = Math.max(0, (Date.now() - postTime) / (1000 * 60 * 60));
        const timeDecay = 1 / Math.pow(1 + ageHours / 36, 1.2);

        const totalScore = (interestScore * 1.3 + popularityScore * 1.1 + affinityScore) * timeDecay;

        return { post, totalScore };
      });

      scoredPosts.sort((a, b) => b.totalScore - a.totalScore);
      hydrated = scoredPosts.map((sp) => sp.post);
    }

    return hydrated.slice(0, limit);
  } catch (err) {
    console.error('listFeed error:', err);
    throw err;
  }
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
    try {
      const postPreview = post.content?.trim().slice(0, 80) ?? '';
      const meta = JSON.stringify({ postId, parentId: null, childId: null });
      await feedModel.createNotification({
        userId: post.author_id,
        type: 'post_like',
        title: 'New like on your post',
        description: `<!--meta:${meta}-->${postPreview}`,
        fromUserId: userId,
        postId,
      });
    } catch (err) {
      console.error('[likePost] Notification creation failed:', err);
    }
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
  let content = input.content?.trim();
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
  let parentAuthorId: string | null = null;

  if (input.parentCommentId) {
    const parent = await feedModel.findCommentById(input.parentCommentId);
    if (!parent || parent.post_id !== postId) {
      throw new HttpError('Parent comment not found on this post', 404);
    }
    if (parent.parent_comment_id) {
      throw new HttpError('Replies can only be one level deep', 400);
    }
    parentCommentId = parent.id;
    parentAuthorId = parent.author_id;

    // Secure backend mention for replies:
    // Check if parent author is confirmed ally with authorId
    const connectionIds = await feedModel.findAcceptedConnectionIds(authorId);
    const isAlly = authorId === parent.author_id || connectionIds.has(parent.author_id);
    let mentionTag = '@anonymous';
    if (isAlly) {
      const profileMap = await feedModel.findProfilesByIds([parent.author_id]);
      const parentProfile = profileMap.get(parent.author_id);
      const parentUsername = parentProfile?.username;
      if (parentUsername) {
        mentionTag = `@${parentUsername}`;
      }
    }

    // Normalize any leading # mention to @
    content = content.replace(/^#([a-zA-Z0-9_-]+)/, '@$1');
    if (!content.includes(mentionTag) && !content.startsWith('@')) {
      content = `${mentionTag} ${content}`;
    }
  }

  const comment = await feedModel.insertComment({ postId, authorId, content, parentCommentId });

  const contentPreview = content.trim().slice(0, 120);

  // 1. Notify the post author (unless commenting on your own post).
  if (post.author_id !== authorId) {
    try {
      const meta = JSON.stringify({ postId, commentId: comment.id, parentId: null, childId: comment.id });
      await feedModel.createNotification({
        userId: post.author_id,
        type: 'post_comment',
        title: 'New comment on your post',
        description: `<!--meta:${meta}-->${contentPreview}`,
        fromUserId: authorId,
        postId,
        commentId: comment.id,
      });
    } catch (err) {
      console.error('[createComment] Post author notification failed:', err);
    }
  }

  // 2. Replies also notify the parent comment's author.
  if (parentCommentId && parentAuthorId && parentAuthorId !== authorId) {
    try {
      const meta = JSON.stringify({ postId, commentId: comment.id, parentId: parentCommentId, childId: comment.id });
      await feedModel.createNotification({
        userId: parentAuthorId,
        type: 'comment_reply',
        title: 'New reply to your comment',
        description: `<!--meta:${meta}-->${contentPreview}`,
        fromUserId: authorId,
        postId,
        commentId: comment.id,
      });
    } catch (err) {
      console.error('[createComment] Parent comment author notification failed:', err);
    }
  }

  // 3. Scan comment for mentions: e.g. @username or legacy #username
  const mentionMatches = content.match(/(?:^|\s)[@#]([a-zA-Z0-9_]+)/g);
  if (mentionMatches) {
    try {
      const rawUsernames = mentionMatches
        .map((m) => m.trim().replace(/^[@#]/, ''))
        .filter((u) => u.toLowerCase() !== 'anonymous');
      const uniqueUsernames = [...new Set(rawUsernames)];
      const mentionedProfiles = await feedModel.findProfilesByUsernames(uniqueUsernames);

      const alreadyNotified = new Set<string>([authorId]);
      if (post.author_id !== authorId) alreadyNotified.add(post.author_id);
      if (parentAuthorId && parentAuthorId !== authorId) alreadyNotified.add(parentAuthorId);

      for (const profile of mentionedProfiles) {
        if (!alreadyNotified.has(profile.id)) {
          alreadyNotified.add(profile.id);
          await feedModel.createNotification({
            userId: profile.id,
            type: 'comment_mention',
            title: 'Mentioned you in a comment',
            description: contentPreview,
            fromUserId: authorId,
            postId,
          });
        }
      }
    } catch (err) {
      console.error('[createComment] Mention notification failed:', err);
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
    try {
      const commentPreview = comment.content?.trim().slice(0, 120) ?? '';
      const meta = JSON.stringify({
        postId: comment.post_id,
        commentId,
        parentId: comment.parent_comment_id || null,
        childId: commentId,
      });
      await feedModel.createNotification({
        userId: comment.author_id,
        type: 'comment_like',
        title: 'New like on your comment',
        description: `<!--meta:${meta}-->${commentPreview}`,
        fromUserId: userId,
        postId: comment.post_id,
        commentId,
      });
    } catch (err) {
      console.error('[likeComment] Notification creation failed:', err);
    }
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