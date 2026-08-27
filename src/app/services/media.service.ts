// src/app/services/media.service.ts

import * as mediaModel from '../models/media.model';
import { HttpError } from '../types/auth.types';
import type { MediaUploadResponse, PostMediaUploadResponse } from '../types/media.types';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;  // 50 MB
const MAX_POST_IMAGES = 4;

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ALLOWED_CHAT_TYPES = new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]);

function validateImageFile(buffer: Buffer, contentType: string): void {
  if (buffer.length === 0) throw new HttpError('Uploaded file is empty', 400);
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError('File exceeds the 10 MB upload limit', 400);
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new HttpError('Unsupported file type. Use JPEG, PNG, WebP or GIF.', 400);
}

function validateChatFile(buffer: Buffer, contentType: string): void {
  if (buffer.length === 0) throw new HttpError('Uploaded file is empty', 400);

  const isVideo = ALLOWED_VIDEO_TYPES.has(contentType);
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  if (buffer.length > maxBytes) {
    throw new HttpError(
      isVideo ? 'Video exceeds the 50 MB upload limit' : 'Image exceeds the 10 MB upload limit',
      400,
    );
  }

  if (!ALLOWED_CHAT_TYPES.has(contentType)) {
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
  const { buffer, contentType } = input;
  validateChatFile(buffer, contentType);

  const url = await mediaModel.uploadChatMedia(input);
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

  for (const file of files) validateImageFile(file.buffer, file.contentType);

  const urls = await mediaModel.uploadPostMediaBatch(userId, files);
  return { urls };
}