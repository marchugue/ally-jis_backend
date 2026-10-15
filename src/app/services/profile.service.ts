import * as profileModel from '../models/profile.model';
import * as interactionModel from '../models/interaction.model';
import * as matchModel from '../models/matchmaking.model';
import { HttpError } from '../types/auth.types';
import * as followModel from '../models/follow.model';
import { getDeterministicAnonymousAvatar } from '../constants/anonymousIdentity';
import type { DiscoverProfileItem, ProfileFilterOptions, ProfileRow, UpdateProfilePayload, UsernameAvailability } from '../types/profile.types';

/**
 * GET /profiles/me, GET /profiles/:userId
 */
export async function getProfile(id: string, viewerId?: string): Promise<ProfileRow> {
  const profile = await profileModel.findById(id);
  if (!profile) {
    throw new HttpError('Profile not found', 404);
  }

  // If viewing another user and not confirmed allies, mask real identifying info
  if (viewerId && viewerId !== id) {
    const unrevealedMatch = await matchModel.getUnrevealedMatchBetween(viewerId, id);
    if (unrevealedMatch) {
      const isUserA = unrevealedMatch.user_a_id === viewerId;
      const partnerAlias = isUserA ? unrevealedMatch.user_b_alias : unrevealedMatch.user_a_alias;
      const partnerAvatar = isUserA ? unrevealedMatch.user_b_avatar : unrevealedMatch.user_a_avatar;
      const avatarKey = partnerAvatar || 'fox';
      return {
        ...profile,
        full_name: partnerAlias || 'Anonymous Ally',
        username: 'anonymous',
        avatar_url: null,
        avatar_preset_id: avatarKey,
        avatarKey,
        bio: null,
        is_ally: true,
        is_unrevealed_match: true,
      };
    }

    const isAlly = await interactionModel.isAllies(viewerId, id);
    const fallbackKey = profile.avatar_preset_id || getDeterministicAnonymousAvatar(id);
    return {
      ...profile,
      avatarKey: fallbackKey,
      avatar_preset_id: profile.avatar_preset_id || fallbackKey,
      is_ally: isAlly,
      is_unrevealed_match: false,
    };
  }

  return {
    ...profile,
    avatarKey: profile.avatar_preset_id || getDeterministicAnonymousAvatar(id),
    is_ally: true,
    is_unrevealed_match: false,
  };
}

/**
 * GET /profiles?exclude={userId}&department=...&search=...&sortBy=match|popular|recent|name
 */
export async function listProfiles(
  filters: ProfileFilterOptions | string | null = {}
): Promise<DiscoverProfileItem[]> {
  const options: ProfileFilterOptions =
    typeof filters === 'string'
      ? { excludeId: filters }
      : (filters || {});

  const {
    excludeId,
    viewerId,
    search,
    department,
    course,
    year_level,
    interest,
    sortBy = 'recent',
    limit = 50,
    offset = 0,
  } = options;

  const rawProfiles = await profileModel.findFilteredProfiles({
    excludeId,
    search,
    department,
    course,
    year_level,
    interest,
  });

  // Collect allies and past matches to strictly show all non-ally and non-match students
  let allyIds = new Set<string>();
  let matchedUserIds = new Set<string>();

  if (viewerId) {
    try {
      allyIds = await interactionModel.getAllyIds(viewerId);
    } catch (err) {
      console.warn('[listProfiles] getAllyIds error:', err);
    }

    try {
      const { supabaseAdmin } = await import('../../config/supabase');
      const { data: userMatches } = await supabaseAdmin
        .from('matches')
        .select('user_a_id, user_b_id')
        .or(`user_a_id.eq.${viewerId},user_b_id.eq.${viewerId}`);

      for (const m of (userMatches as any[]) ?? []) {
        const partnerId = m.user_a_id === viewerId ? m.user_b_id : m.user_a_id;
        if (partnerId) matchedUserIds.add(partnerId);
      }
    } catch (err) {
      console.warn('[listProfiles] userMatches error:', err);
    }
  }

  // Filter out self, allies, and anyone already matched
  const candidates = rawProfiles.filter((p) => {
    if (viewerId && p.id === viewerId) return false;
    if (excludeId && p.id === excludeId) return false;
    if (allyIds.has(p.id)) return false;
    if (matchedUserIds.has(p.id)) return false;
    return true;
  });

  // Enrich candidate profiles with real data and compatibility score
  let viewerProfile: ProfileRow | null = null;
  if (viewerId) {
    viewerProfile = await profileModel.findById(viewerId).catch(() => null);
  }

  const viewerInterests = new Set(
    (viewerProfile?.interests || []).map((i) => i.toLowerCase().trim())
  );
  const totalViewerInterests = Math.max(1, viewerInterests.size);

  const enriched: DiscoverProfileItem[] = candidates.map((p) => {
    let sharedInterestsCount = 0;
    if (Array.isArray(p.interests)) {
      for (const userInt of p.interests) {
        if (viewerInterests.has(userInt.toLowerCase().trim())) {
          sharedInterestsCount++;
        }
      }
    }

    const sameDept = Boolean(
      viewerProfile?.department &&
      p.department &&
      viewerProfile.department.toLowerCase() === p.department.toLowerCase()
    );
    const sameCourse = Boolean(
      viewerProfile?.course &&
      p.course &&
      viewerProfile.course.toLowerCase() === p.course.toLowerCase()
    );

    const totalUnique = new Set([...viewerInterests, ...(p.interests || []).map((i) => i.toLowerCase().trim())]).size;
    const interestScore =
      totalUnique > 0 && sharedInterestsCount > 0
        ? Math.round((sharedInterestsCount / totalUnique) * 45 + Math.min(sharedInterestsCount * 3, 10))
        : 0;
    const academicScore = sameCourse ? 15 : sameDept ? 8 : 0;
    const matchPercentage = Math.min(Math.max(15 + interestScore + academicScore, 15), 99);

    const avatarKey = p.avatar_preset_id || getDeterministicAnonymousAvatar(p.id);

    return {
      ...p,
      full_name: p.full_name || (p.username ? `@${p.username}` : 'Student'),
      username: p.username ?? '',
      avatar_url: p.avatar_url,
      avatarKey,
      avatar_preset_id: p.avatar_preset_id || avatarKey,
      bio: p.bio,
      is_ally: false,
      is_unrevealed_match: false,
      sharedInterestsCount,
      matchPercentage,
    };
  });

  if (sortBy === 'match') {
    enriched.sort((a, b) => (b.matchPercentage || 0) - (a.matchPercentage || 0));
  } else if (sortBy === 'popular') {
    const withFollowers = await Promise.all(
      enriched.map(async (item) => {
        const { followersCount } = await followModel.getCounts(item.id).catch(() => ({ followersCount: 0 }));
        return { ...item, followersCount };
      })
    );
    withFollowers.sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0));
    return withFollowers.slice(offset, offset + limit);
  } else if (sortBy === 'name') {
    enriched.sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || ''));
  }

  return enriched.slice(offset, offset + limit);
}

/**
 * POST /profiles/batch
 */
export async function getProfilesByIds(ids: string[], viewerId?: string): Promise<ProfileRow[]> {
  const profiles = await profileModel.findByIds(ids);
  if (!viewerId) return profiles;

  let allyIds = new Set<string>();
  try {
    allyIds = await interactionModel.getAllyIds(viewerId);
  } catch {}

  return profiles.map((p) => {
    const isSelf = p.id === viewerId;
    const isAlly = allyIds.has(p.id);
    const fallbackKey = p.avatar_preset_id || getDeterministicAnonymousAvatar(p.id);
    return {
      ...p,
      avatarKey: fallbackKey,
      avatar_preset_id: p.avatar_preset_id || fallbackKey,
      is_ally: isSelf || isAlly,
      is_unrevealed_match: false,
    };
  });
}

/**
 * GET /profiles/check-username
 */
export async function checkUsernameAvailability(
  username: string,
  excludeId?: string | null
): Promise<UsernameAvailability> {
  const taken = await profileModel.isUsernameTaken(username, excludeId);
  return { available: !taken };
}

/**
 * PATCH /profiles/me
 */
export async function updateProfile(id: string, payload: UpdateProfilePayload): Promise<ProfileRow> {
  if (payload.username) {
    const taken = await profileModel.isUsernameTaken(payload.username, id);
    if (taken) {
      throw new HttpError('Username already taken', 409);
    }
  }

  const updated = await profileModel.updateById(id, payload);

  // If the profile now meets all onboarding criteria, sync onboarding_complete: true to auth metadata
  if (updated.course && updated.department && updated.year_level) {
    try {
      const { supabaseAdmin } = await import('../../config/supabase');
      const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(id);
      if (userRes?.user) {
        await supabaseAdmin.auth.admin.updateUserById(id, {
          user_metadata: {
            ...userRes.user.user_metadata,
            onboarding_complete: true,
            course: updated.course,
            department: updated.department,
            year_level: updated.year_level,
            avatar_url: updated.avatar_url,
          },
        });
      }
    } catch (authErr) {
      console.error('Failed to sync auth user_metadata for onboarding completion:', authErr);
    }
  }

  return updated;
}

/**
 * DELETE /profiles/me
 */
export async function deleteProfile(id: string): Promise<void> {
  await profileModel.deleteByAuthUserId(id);
}