import { supabaseAdmin } from '../../config/supabase';

const CHAT_MEDIA_BUCKET = 'chat-media';
const POST_MEDIA_BUCKET = 'post-media';

/**
 * Uploads a file buffer to the chat-media bucket (created in schema.sql)
 * under chat-media/{userId}/{timestamp}-{originalFilename}, then returns
 * its public URL. The bucket is public, so getPublicUrl is sufficient —
 * no signed URL needed.
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

  const { error } = await supabaseAdmin.storage.from(CHAT_MEDIA_BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });

  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Uploads a single file buffer to the post-media bucket (created in
 * post_media_migration.sql) under post-media/{userId}/{timestamp}-{index}-{originalFilename}.
 * The `index` segment keeps filenames unique even when several files in
 * the same batch share a timestamp and original name.
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

  const { error } = await supabaseAdmin.storage.from(POST_MEDIA_BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });

  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(POST_MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Uploads a batch of files (max 4, enforced in the service layer) in
 * parallel and returns their public URLs in the same order they were
 * submitted, so the caller can map index -> position when inserting
 * post_media rows.
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