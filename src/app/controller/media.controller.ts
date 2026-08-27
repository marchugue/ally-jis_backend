// src/controllers/media.controller.ts
//
// CONTROLLER LAYER — reads req, calls service, writes HTTP response.
// Uses multer with memory storage — no disk writes.

import type { Request, Response } from 'express';
import multer from 'multer';
import * as mediaService from '../services/media.service';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError } from '../types/auth.types';

// 50 MB ceiling so multer doesn't reject video uploads before we can
// produce a proper validation error in the service layer.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// POST /media/chat — supports images AND videos
export const uploadChatMedia = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    throw new HttpError('No file uploaded — expected multipart field "file"', 400);
  }

  const result = await mediaService.uploadChatMedia({
    userId: req.userId as string,
    buffer: file.buffer,
    originalFilename: file.originalname,
    contentType: file.mimetype,
  });

  res.status(201).json(result);
});

// POST /media/posts — multipart/form-data, field name "files" (up to 4)
export const uploadPostMedia = asyncHandler(async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) ?? [];

  const result = await mediaService.uploadPostMedia({
    userId: req.userId as string,
    files: files.map((file) => ({
      buffer: file.buffer,
      originalFilename: file.originalname,
      contentType: file.mimetype,
    })),
  });

  res.status(201).json(result);
});