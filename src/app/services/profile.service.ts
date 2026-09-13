import * as profileModel from '../models/profile.model';
import { HttpError } from '../types/auth.types';
import * as followModel from '../models/follow.model';
import type { DiscoverProfileItem, ProfileFilterOptions, ProfileRow, UpdateProfilePayload, UsernameAvailability } from '../types/profile.types';

/**
 * GET /profiles/me, GET /profiles/:userId
 */
export async function getProfile(id: string): Promise<ProfileRow> {
  const profile = await profileModel.findById(id);
  if (!profile) {
    throw new HttpError('Profile not found', 404);
  }
  return profile;
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

  // If viewerId is provided or match / popularity sorting requested, enrich profiles
  let viewerProfile: ProfileRow | null = null;
  if (viewerId) {
    viewerProfile = await profileModel.findById(viewerId).catch(() => null);
  }

  const viewerInterests = new Set(
    (viewerProfile?.interests || []).map((i) => i.toLowerCase().trim())
  );
  const totalViewerInterests = Math.max(1, viewerInterests.size);

  const enriched: DiscoverProfileItem[] = rawProfiles.map((p) => {
    let sharedInterestsCount = 0;
    if (Array.isArray(p.interests)) {
      for (const userInt of p.interests) {
        if (viewerInterests.has(userInt.toLowerCase().trim())) {
          sharedInterestsCount++;
        }
      }
    }

    const matchPercentage = Math.min(
      100,
      Math.round(
        (sharedInterestsCount / totalViewerInterests) * 70 +
          (viewerProfile?.department && p.department === viewerProfile.department ? 20 : 0) +
          (viewerProfile?.course && p.course === viewerProfile.course ? 10 : 0)
      )
    );

    return {
      ...p,
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
export async function getProfilesByIds(ids: string[]): Promise<ProfileRow[]> {
  return profileModel.findByIds(ids);
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
  if (updated.course && updated.department && updated.year_level && Array.isArray(updated.interests) && updated.interests.length >= 3) {
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