// src/routes/feed.routes.ts
//
// ROUTE LAYER
// -----------
// Declares the URL + HTTP method, attaches middleware, calls the
// controller. No logic lives here.
//
// IMPORTANT: static paths (/users/:userId, /posts) must be registered
// before any conflicting dynamic segments. /posts/:postId/comments and
// /comments/:commentId are split into separate sub-trees so there's no
// ambiguity between post ids and comment ids.

import { Router } from 'express';
import * as feedController from '../app/controller/feed.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

router.use((req, res, next) => {
  console.log('✅ Auth passed, userId:', req.userId);
  next();
});

router.use(authMiddleware);

// GET /api/feed
router.get('/', feedController.listFeed);

// GET /api/feed/users/:userId
router.get('/users/:userId', feedController.listPostsByAuthor);

// POST /api/feed/posts
router.post('/posts', feedController.createPost);

// GET /api/feed/posts/:postId
router.get('/posts/:postId', feedController.getPost);

// PATCH /api/feed/posts/:postId
router.patch('/posts/:postId', feedController.updatePost);

// DELETE /api/feed/posts/:postId
router.delete('/posts/:postId', feedController.deletePost);

// POST /api/feed/posts/:postId/like
router.post('/posts/:postId/like', feedController.likePost);

// DELETE /api/feed/posts/:postId/like
router.delete('/posts/:postId/like', feedController.unlikePost);

// GET /api/feed/posts/:postId/comments
router.get('/posts/:postId/comments', feedController.listComments);

// POST /api/feed/posts/:postId/comments
router.post('/posts/:postId/comments', feedController.createComment);

// PATCH /api/feed/comments/:commentId
router.patch('/comments/:commentId', feedController.updateComment);

// DELETE /api/feed/comments/:commentId
router.delete('/comments/:commentId', feedController.deleteComment);

// POST /api/feed/comments/:commentId/like
router.post('/comments/:commentId/like', feedController.likeComment);

// DELETE /api/feed/comments/:commentId/like
router.delete('/comments/:commentId/like', feedController.unlikeComment);

export default router;