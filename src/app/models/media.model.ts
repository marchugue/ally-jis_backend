// src/app/models/media.model.ts

import { supabaseAdmin } from '../../config/supabase';
import { uploadToR2Storage } from '../../config/r2';

const CHAT_MEDIA_BUCKET = 'chat-media';
const POST_MEDIA_BUCKET = 'post-media';

/**
 * Core upload helper — tries Cloudflare R2 first.
 * Falls back to Supabase Storage if R2 is not configured.
 */
async function uploadFile(input: {
  bucket: string;
  path: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string> {
  const { bucket, path, buffer, contentType } = input;

  // Try R2 first
  const r2Url = await uploadToR2Storage({ path: `${bucket}/${path}`, buffer, contentType });
  if (r2Url) return r2Url;

  // Fallback: Supabase Storage
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Uploads a file buffer to the chat-media bucket.
 * Uses R2 if configured, Supabase Storage otherwise.
 */
export async function uploadChatMedia(input: {
  userId: string;
  buffer: Buffer;
  originalFilename: string;
  contentType: string;
}): Promise<string> {
  const { userId, buffer, originalFilename, contentType } = input;
  const safeFilename = originalFilename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${userId}/${Date.now()}-${safeFilename}`;

  return uploadFile({ bucket: CHAT_MEDIA_BUCKET, path, buffer, contentType });
}

/**
 * Uploads a single file to the post-media bucket.
 */
export async function uploadPostMediaFile(input: {
  userId: string;
  buffer: Buffer;
  originalFilename: string;
  contentType: string;
  index: number;
}): Promise<string> {
  const { userId, buffer, originalFilename, contentType, index } = input;
  const safeFilename = originalFilename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${userId}/${Date.now()}-${index}-${safeFilename}`;

  return uploadFile({ bucket: POST_MEDIA_BUCKET, path, buffer, contentType });
}

/**
 * Uploads a batch of post media files in parallel and returns their URLs.
 */
export async function uploadPostMediaBatch(
  userId: string,
  files: { buffer: Buffer; originalFilename: string; contentType: string }[]
): Promise<string[]> {
  return Promise.all(
    files.map((file, index) =>
      uploadPostMediaFile({
        userId,
        buffer: file.buffer,
        originalFilename: file.originalFilename,
        contentType: file.contentType,
        index,
      })
    )
  );
}