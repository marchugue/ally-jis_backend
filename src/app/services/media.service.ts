// src/app/services/media.service.ts

import * as mediaModel from '../models/media.model';
import { HttpError } from '../types/auth.types';
import type { MediaUploadResponse, PostMediaUploadResponse } from '../types/media.types';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;  // 50 MB
const MAX_POST_IMAGES = 4;

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ALLOWED_CHAT_TYPES = new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]);

function normalizeContentType(contentType: string): string {
  const clean = contentType.toLowerCase().split(';')[0].trim();
  if (clean === 'image/jpg') return 'image/jpeg';
  return clean;
}

function validateImageFile(buffer: Buffer, contentType: string): void {
  if (buffer.length === 0) throw new HttpError('Uploaded file is empty', 400);
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError('File exceeds the 10 MB upload limit', 400);
  const normalized = normalizeContentType(contentType);
  if (!ALLOWED_IMAGE_TYPES.has(normalized) && !ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new HttpError('Unsupported file type. Use JPEG, PNG, WebP or GIF.', 400);
  }
}

function validateChatFile(buffer: Buffer, contentType: string): void {
  if (buffer.length === 0) throw new HttpError('Uploaded file is empty', 400);

  const normalized = normalizeContentType(contentType);
  const isVideo = ALLOWED_VIDEO_TYPES.has(normalized);
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  if (buffer.length > maxBytes) {
    throw new HttpError(
      isVideo ? 'Video exceeds the 50 MB upload limit' : 'Image exceeds the 10 MB upload limit',
      400,
    );
  }

  if (!ALLOWED_CHAT_TYPES.has(normalized) && !ALLOWED_CHAT_TYPES.has(contentType)) {
    throw new HttpError('Unsupported file type. Use JPEG, PNG, WebP, GIF, MP4, WebM or MOV.', 400);
  }
}

/**
 * POST /media/chat
 * Validates image OR video upload before forwarding to the model.
 */
export async function uploadChatMedia(input: {
  userId: string;
  buffer: Buffer;
  originalFilename: string;
  contentType: string;
}): Promise<MediaUploadResponse> {
  const normalizedContentType = normalizeContentType(input.contentType);
  validateChatFile(input.buffer, normalizedContentType);

  const url = await mediaModel.uploadChatMedia({
    ...input,
    contentType: normalizedContentType,
  });
  return { url };
}

/**
 * POST /media/posts
 * Validates each image file and the batch size (max 4) before uploading.
 */
export async function uploadPostMedia(input: {
  userId: string;
  files: { buffer: Buffer; originalFilename: string; contentType: string }[];
}): Promise<PostMediaUploadResponse> {
  const { userId, files } = input;

  if (files.length === 0) throw new HttpError('No files uploaded — expected multipart field "files"', 400);
  if (files.length > MAX_POST_IMAGES) throw new HttpError(`A post can have at most ${MAX_POST_IMAGES} images`, 400);

  const normalizedFiles = files.map((file) => {
    const normalized = normalizeContentType(file.contentType);
    validateImageFile(file.buffer, normalized);
    return {
      ...file,
      contentType: normalized,
    };
  });

  const urls = await mediaModel.uploadPostMediaBatch(userId, normalizedFiles);
  return { urls };
}