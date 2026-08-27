// src/app/types/follow.types.ts

export interface FollowRow {
  follower_id: string;
  followed_id: string;
  created_at: string;
}

export interface FollowStatusResponse {
  isFollowing: boolean;
  isFollowedBy: boolean;
}

export interface FollowCounts {
  followersCount: number;
  followingCount: number;
}

/** A follower/following list item — a thin profile projection, not the
 * full ProfileRow, since list views only ever need this much. */
export interface FollowListItem {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  course: string | null;
  followedAt: string;
}

export interface PaginatedFollowList {
  items: FollowListItem[];
  nextCursor: string | null;
}
