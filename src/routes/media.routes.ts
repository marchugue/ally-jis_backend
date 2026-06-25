// src/routes/media.routes.ts
//
// ROUTE LAYER
// -----------
// Declares the URL + HTTP method, attaches middleware, calls the
// controller. No logic lives here.

import { Router } from 'express';
import * as mediaController from '../app/controller/media.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

// POST /api/media/chat — multipart/form-data, field name "file"
router.post('/chat', authMiddleware, mediaController.upload.single('file'), mediaController.uploadChatMedia);

// POST /api/media/posts — multipart/form-data, field name "files" (up to 4)
router.post('/posts', authMiddleware, mediaController.upload.array('files', 4), mediaController.uploadPostMedia);

export default router;