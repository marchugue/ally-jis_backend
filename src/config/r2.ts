import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from './env';

export const isR2Configured = Boolean(
  env.R2_ACCESS_KEY_ID &&
  env.R2_SECRET_ACCESS_KEY &&
  (env.R2_ENDPOINT || env.R2_ACCOUNT_ID)
);

let r2Client: S3Client | null = null;

if (isR2Configured) {
  const endpoint = env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  r2Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Uploads a file buffer to Cloudflare R2 if configured,
 * otherwise returns null so caller can handle fallback (e.g. Supabase Storage).
 */
export async function uploadToR2Storage(input: {
  path: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string | null> {
  if (!r2Client) {
    return null;
  }

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: input.path,
    Body: input.buffer,
    ContentType: input.contentType,
  });

  await r2Client.send(command);

  if (env.R2_PUBLIC_DOMAIN) {
    const domain = env.R2_PUBLIC_DOMAIN.endsWith('/')
      ? env.R2_PUBLIC_DOMAIN.slice(0, -1)
      : env.R2_PUBLIC_DOMAIN;
    return `${domain}/${input.path}`;
  }

  const endpoint = env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return `${endpoint}/${env.R2_BUCKET_NAME}/${input.path}`;
}

/**
 * Deletes an object from Cloudflare R2 by its stored path key.
 * Returns true on success, false if R2 is not configured or deletion fails.
 */
export async function deleteFromR2Storage(path: string): Promise<boolean> {
  if (!r2Client) {
    return false;
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: path,
    });
    await r2Client.send(command);
    return true;
  } catch (err) {
    console.error('[R2] Failed to delete object:', path, err);
    return false;
  }
}
