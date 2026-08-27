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

  return profileModel.updateById(id, payload);
}

/**
 * DELETE /profiles/me
 */
export async function deleteProfile(id: string): Promise<void> {
  await profileModel.deleteByAuthUserId(id);
}