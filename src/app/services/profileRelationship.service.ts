// src/app/services/profileRelationship.service.ts
//
// Cross-domain by design — pulls from both follow.model.ts and
// interaction.model.ts, since the profile page's relationship section
// needs both in one shot. Mirrors the same direct-model-import pattern
// already used elsewhere (e.g. conversation.service.ts importing
// matchmaking.model.ts) rather than adding another service-to-service
// hop for what's fundamentally a read-only aggregation.

import * as followModel from '../models/follow.model';
import * as interactionModel from '../models/interaction.model';
import type { RelationshipStatus } from '../types/interaction.types';

export interface ProfileRelationshipSummary {
  allyStatus: RelationshipStatus;
  isFollowing: boolean;
  isFollowedBy: boolean;
  followersCount: number;
  followingCount: number;
  alliesCount: number;
  mutualAlliesCount: number;
  mutualFollowersCount: number;
  mutualFollowingCount: number;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const id of a) if (b.has(id)) count++;
  return count;
}

export async function getRelationshipSummary(viewerId: string, targetId: string): Promise<ProfileRelationshipSummary> {
  if (viewerId === targetId) {
    // Own profile — no "relationship" to another person, just their own counts.
    const [followCounts, alliesCount] = await Promise.all([
      followModel.getCounts(viewerId),
      interactionModel.getAlliesCount(viewerId),
    ]);
    return {
      allyStatus: 'none',
      isFollowing: false,
      isFollowedBy: false,
      followersCount: followCounts.followersCount,
      followingCount: followCounts.followingCount,
      alliesCount,
      mutualAlliesCount: 0,
      mutualFollowersCount: 0,
      mutualFollowingCount: 0,
    };
  }

  const [
    followStatus,
    targetFollowCounts,
    targetAlliesCount,
    myAllyIds,
    theirAllyIds,
    myFollowerIds,
    theirFollowerIds,
    myFollowingIds,
    theirFollowingIds,
    myStatus,
    theirStatus,
  ] = await Promise.all([
    followModel.getStatus(viewerId, targetId),
    followModel.getCounts(targetId),
    interactionModel.getAlliesCount(targetId),
    interactionModel.getAllyIds(viewerId),
    interactionModel.getAllyIds(targetId),
    followModel.getFollowerIds(viewerId),
    followModel.getFollowerIds(targetId),
    followModel.getFollowingIds(viewerId),
    followModel.getFollowingIds(targetId),
    interactionModel.findStatus(viewerId, targetId),
    interactionModel.findStatus(targetId, viewerId),
  ]);

  let allyStatus: RelationshipStatus = 'none';
  if (myStatus === 'accepted' && theirStatus === 'accepted') allyStatus = 'allies';
  else if (myStatus === 'pending') allyStatus = 'pending_outgoing';
  else if (theirStatus === 'pending') allyStatus = 'pending_incoming';

  return {
    allyStatus,
    isFollowing: followStatus.isFollowing,
    isFollowedBy: followStatus.isFollowedBy,
    followersCount: targetFollowCounts.followersCount,
    followingCount: targetFollowCounts.followingCount,
    alliesCount: targetAlliesCount,
    mutualAlliesCount: intersectionSize(myAllyIds, theirAllyIds),
    mutualFollowersCount: intersectionSize(myFollowerIds, theirFollowerIds),
    mutualFollowingCount: intersectionSize(myFollowingIds, theirFollowingIds),
  };
}
