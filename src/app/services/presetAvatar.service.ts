// src/app/services/presetAvatar.service.ts
//
// SERVICE LAYER — orchestrates R2 upload/delete and DB model calls.
// No HTTP-specific logic here.

import * as presetAvatarModel from '../models/presetAvatar.model';
import { uploadToR2Storage, deleteFromR2Storage } from '../../config/r2';
import { HttpError } from '../types/auth.types';
import type { PresetAvatarRow } from '../types/presetAvatar.types';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Returns all admin-curated preset avatar images.
 */
export async function listPresetAvatars(): Promise<PresetAvatarRow[]> {
  return presetAvatarModel.listPresetAvatars();
}

/**
 * Admin: uploads a new preset avatar image to Cloudflare R2 and registers it in the DB.
 */
export async function createPresetAvatar(input: {
  buffer: Buffer;
  originalFilename: string;
  contentType: string;
  label?: string | null;
}): Promise<PresetAvatarRow> {
  const { buffer, originalFilename, contentType, label } = input;

  if (buffer.length === 0) {
    throw new HttpError('Uploaded file is empty', 400);
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw new HttpError('File exceeds the 10 MB upload limit', 400);
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HttpError('Unsupported file type. Use JPEG, PNG, WebP or GIF.', 400);
  }

  const safeFilename = originalFilename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const r2Path = `preset-avatars/${Date.now()}-${safeFilename}`;

  const r2Url = await uploadToR2Storage({ path: r2Path, buffer, contentType });

  if (!r2Url) {
    throw new HttpError(
      'Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in your environment.',
      503,
    );
  }

  return presetAvatarModel.createPresetAvatar({
    label: label ?? null,
    url: r2Url,
    r2_path: r2Path,
  });
}

/**
 * Admin: deletes a preset avatar from Cloudflare R2 and removes its DB record.
 */
export async function deletePresetAvatar(id: string): Promise<void> {
  const existing = await presetAvatarModel.getPresetAvatarById(id);
  if (!existing) {
    throw new HttpError('Preset avatar not found', 404);
  }

  // Best-effort R2 deletion — don't block DB cleanup if R2 fails.
  await deleteFromR2Storage(existing.r2_path);

  await presetAvatarModel.deletePresetAvatar(id);
}

/**
 * Uploads a user's custom profile photo to Cloudflare R2.
 * Returns the public R2 URL.
 */
export async function uploadUserAvatar(input: {
  userId?: string;
  buffer: Buffer;
  originalFilename: string;
  contentType: string;
}): Promise<string> {
  const { userId, buffer, originalFilename, contentType } = input;

  if (buffer.length === 0) {
    throw new HttpError('Uploaded file is empty', 400);
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw new HttpError('File exceeds the 10 MB upload limit', 400);
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HttpError('Unsupported file type. Use JPEG, PNG, WebP or GIF.', 400);
  }

  const folder = userId ? `avatars/${userId}` : 'avatars/onboarding';
  const safeFilename = originalFilename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const r2Path = `${folder}/${Date.now()}-${safeFilename}`;

  const r2Url = await uploadToR2Storage({ path: r2Path, buffer, contentType });

  if (!r2Url) {
    throw new HttpError(
      'Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in your environment.',
      503,
    );
  }

  return r2Url;
}
