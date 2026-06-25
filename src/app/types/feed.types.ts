// src/types/feed.types.ts

export type PostAudience = 'public' | 'connections';

export interface PostRow {
  id: string;
  author_id: string;
  content: string;
  audience: PostAudience;
  likes_count: number;
  comments_count: number;
  created_at: string;
  updated_at: string;
}

export interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  parent_comment_id: string | null;
  content: string;
  likes_count: number;
  created_at: string;
  updated_at: string;
}

export interface AuthorSummary {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

// A row from post_media — one image, in display order.
export interface PostMediaRow {
  id: string;
  post_id: string;
  url: string;
  position: number;
  created_at: string;
}

export interface PostWithAuthor extends PostRow {
  author: AuthorSummary | null;
  liked_by_me: boolean;
  // Ordered by `position`, max 4 entries. Empty array for text-only posts.
  media: PostMediaRow[];
}

export interface CommentWithAuthor extends CommentRow {
  author: AuthorSummary | null;
  liked_by_me: boolean;
}

export interface LikeStatusResponse {
  liked: boolean;
  likesCount: number;
}

export interface CreatePostPayload {
  content: string;
  audience?: PostAudience;
  // Public URLs already uploaded via POST /media/posts, in display order.
  // Max 4, matching the post_media schema constraint.
  mediaUrls?: string[];
}

export interface UpdatePostPayload {
  content?: string;
  audience?: PostAudience;
}

export interface CreateCommentPayload {
  content: string;
  parentCommentId?: string | null;
}