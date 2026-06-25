import * as mediaModel from '../models/media.model';
import { HttpError } from '../types/auth.types';
import type { MediaUploadResponse, PostMediaUploadResponse } from '../types/media.types';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_POST_IMAGES = 4;

function validateImageFile(buffer: Buffer, contentType: string): void {
  if (buffer.length === 0) {
    throw new HttpError('Uploaded file is empty', 400);
  }

  if (buffer.length > MAX_FILE_BYTES) {
    throw new HttpError('File exceeds the 10MB upload limit', 400);
  }

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HttpError('Unsupported file type', 400);
  }
}

/**
 * POST /media/chat
 * Validates the upload (size + type) before handing it to Supabase Storage.
 */
export async function uploadChatMedia(input: {
  userId: string;
  buffer: Buffer;
  originalFilename: string;
  contentType: string;
}): Promise<MediaUploadResponse> {
  const { buffer, contentType } = input;
  validateImageFile(buffer, contentType);

  const url = await mediaModel.uploadChatMedia(input);
  return { url };
}

/**
 * POST /media/posts
 * Validates each file (size + type) and the batch size (max 4, matching
 * the post_media schema's position check 0-3) before uploading. Runs all
 * validation up front so we never partially upload a batch and then fail.
 */
export async function uploadPostMedia(input: {
  userId: string;
  files: { buffer: Buffer; originalFilename: string; contentType: string }[];
}): Promise<PostMediaUploadResponse> {
  const { userId, files } = input;

  if (files.length === 0) {
    throw new HttpError('No files uploaded — expected multipart field "files"', 400);
  }

  if (files.length > MAX_POST_IMAGES) {
    throw new HttpError(`A post can have at most ${MAX_POST_IMAGES} images`, 400);
  }

  for (const file of files) {
    validateImageFile(file.buffer, file.contentType);
  }

  const urls = await mediaModel.uploadPostMediaBatch(userId, files);
  return { urls };
}