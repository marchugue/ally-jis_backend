import * as profileModel from '../models/profile.model';
import { HttpError } from '../types/auth.types';
import type { ProfileRow, UpdateProfilePayload, UsernameAvailability } from '../types/profile.types';

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
 * GET /profiles?exclude={userId}
 */
export async function listProfiles(excludeId?: string | null): Promise<ProfileRow[]> {
  return profileModel.findAllExcluding(excludeId);
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