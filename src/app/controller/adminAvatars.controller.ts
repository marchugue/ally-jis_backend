// src/app/controller/adminAvatars.controller.ts
//
// CONTROLLER LAYER — HTTP ↔ service translation only.
// Admin-only endpoints for managing preset avatar images.

import type { Request, Response } from 'express';
import multer from 'multer';
import * as presetAvatarService from '../services/presetAvatar.service';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError } from '../types/auth.types';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

/**
 * GET /api/admin/avatars/presets
 * GET /api/media/avatars/presets  (public mirror)
 * Returns the list of all admin-curated preset avatar images.
 */
export const listPresetAvatars = asyncHandler(async (_req: Request, res: Response) => {
  const avatars = await presetAvatarService.listPresetAvatars();
  res.json({ avatars });
});

/**
 * POST /api/admin/avatars/presets
 * Admin uploads a new preset avatar image to Cloudflare R2.
 * Body: multipart/form-data — field "file" (image), optional "label" (text).
 */
export const createPresetAvatar = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    throw new HttpError('No file uploaded — expected multipart field "file"', 400);
  }

  const label = typeof req.body?.label === 'string' ? req.body.label.trim() || null : null;

  const avatar = await presetAvatarService.createPresetAvatar({
    buffer: file.buffer,
    originalFilename: file.originalname,
    contentType: file.mimetype,
    label,
  });

  res.status(201).json({ avatar });
});

/**
 * DELETE /api/admin/avatars/presets/:id
 * Admin deletes a preset avatar from R2 and the database.
 */
export const deletePresetAvatar = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    throw new HttpError('Missing avatar ID', 400);
  }

  await presetAvatarService.deletePresetAvatar(id);
  res.status(204).send();
});

/**
 * POST /api/media/avatar
 * User uploads their own profile photo to Cloudflare R2.
 * Returns the public R2 URL.
 */
export const uploadUserAvatar = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    throw new HttpError('No file uploaded — expected multipart field "file"', 400);
  }

  const url = await presetAvatarService.uploadUserAvatar({
    userId: req.userId as string,
    buffer: file.buffer,
    originalFilename: file.originalname,
    contentType: file.mimetype,
  });

  res.status(201).json({ url });
});
