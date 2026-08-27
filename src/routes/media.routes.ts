// src/routes/media.routes.ts
//
// ROUTE LAYER — declares URL + HTTP method, attaches middleware, calls controller.

import { Router } from 'express';
import * as mediaController from '../app/controller/media.controller';
import * as adminAvatarsController from '../app/controller/adminAvatars.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

// GET /api/media/avatars/presets — public, no auth required (for onboarding & profile pickers)
router.get('/avatars/presets', adminAvatarsController.listPresetAvatars);

// POST /api/media/avatar — authenticated user uploads their own profile photo
router.post(
  '/avatar',
  authMiddleware,
  adminAvatarsController.upload.single('file'),
  adminAvatarsController.uploadUserAvatar,
);

// POST /api/media/chat — image or video (up to 50 MB)
router.post(
  '/chat',
  authMiddleware,
  mediaController.upload.single('file'),
  mediaController.uploadChatMedia,
);

// POST /api/media/posts — up to 4 images
router.post(
  '/posts',
  authMiddleware,
  mediaController.upload.array('files', 4),
  mediaController.uploadPostMedia,
);

export default router;