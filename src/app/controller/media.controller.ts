// src/controllers/media.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.
//
// `upload` is multer configured with memory storage (no disk writes) so
// the file buffer can be handed straight to Supabase Storage in the model
// layer. Mount `upload.single('file')` ahead of `uploadChatMedia`, and
// `upload.array('files', 4)` ahead of `uploadPostMedia`, matching the
// field names in the API reference doc.

import type { Request, Response } from 'express';
import multer from 'multer';
import * as mediaService from '../services/media.service';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError } from '../types/auth.types';

export const upload = multer({ storage: multer.memoryStorage() });

// POST /media/chat
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