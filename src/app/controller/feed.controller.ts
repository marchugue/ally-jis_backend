// src/controllers/feed.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as feedService from '../services/feed.service';
import { asyncHandler } from '../utils/asyncHandler';
import type { CreateCommentPayload, CreatePostPayload, UpdatePostPayload } from '../types/feed.types';

// GET /feed?limit=20&before=2026-06-01T00:00:00Z&filter=discover&search=...
export const listFeed = asyncHandler(async (req: Request, res: Response) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const before = req.query.before ? String(req.query.before) : undefined;
  const filter = typeof req.query.filter === 'string' ? (req.query.filter as any) : undefined;
  const department = typeof req.query.department === 'string' ? req.query.department : undefined;
  const course = typeof req.query.course === 'string' ? req.query.course : undefined;
  const interest = typeof req.query.interest === 'string' ? req.query.interest : undefined;
  const search =
    typeof req.query.search === 'string'
      ? req.query.search
      : typeof req.query.q === 'string'
      ? req.query.q
      : undefined;
  const mediaOnly = req.query.mediaOnly === 'true' || req.query.mediaOnly === '1';

  const posts = await feedService.listFeed(req.userId as string, {
    limit,
    before,
    filter,
    department,
    course,
    interest,
    search,
    mediaOnly,
  });
  res.status(200).json(posts);
});

// GET /feed/discover
export const listDiscoverFeed = asyncHandler(async (req: Request, res: Response) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const before = req.query.before ? String(req.query.before) : undefined;
  const department = typeof req.query.department === 'string' ? req.query.department : undefined;
  const course = typeof req.query.course === 'string' ? req.query.course : undefined;
  const interest = typeof req.query.interest === 'string' ? req.query.interest : undefined;
  const search =
    typeof req.query.search === 'string'
      ? req.query.search
      : typeof req.query.q === 'string'
      ? req.query.q
      : undefined;

  const posts = await feedService.listFeed(req.userId as string, {
    limit,
    before,
    filter: 'discover',
    department,
    course,
    interest,
    search,
  });
  res.status(200).json(posts);
});

// GET /feed/users/:userId
export const listPostsByAuthor = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const before = req.query.before ? String(req.query.before) : undefined;

  const posts = await feedService.listPostsByAuthor(req.userId as string, userId, { limit, before });
  res.status(200).json(posts);
});

// GET /feed/posts/:postId
export const getPost = asyncHandler(async (req: Request, res: Response) => {
  const postId = String(req.params.postId);
  const post = await feedService.getPostById(req.userId as string, postId);
  res.status(200).json(post);
});

// POST /feed/posts
// Body: { content, audience?, mediaUrls? } — mediaUrls are public URLs
// already returned by POST /media/posts (upload images first, then
// create the post with the returned urls).
export const createPost = asyncHandler(async (req: Request, res: Response) => {
  const { content, audience, mediaUrls } = req.body as CreatePostPayload;
  const post = await feedService.createPost(req.userId as string, { content, audience, mediaUrls });
  res.status(201).json(post);
});

// PATCH /feed/posts/:postId
export const updatePost = asyncHandler(async (req: Request, res: Response) => {
  const postId = String(req.params.postId);
  const { content, audience } = req.body as UpdatePostPayload;
  const post = await feedService.updatePost(req.userId as string, postId, { content, audience });
  res.status(200).json(post);
});

// DELETE /feed/posts/:postId
export const deletePost = asyncHandler(async (req: Request, res: Response) => {
  const postId = String(req.params.postId);
  await feedService.deletePost(req.userId as string, postId);
  res.status(204).send();
});

// POST /feed/posts/:postId/like
export const likePost = asyncHandler(async (req: Request, res: Response) => {
  const postId = String(req.params.postId);
  const result = await feedService.likePost(req.userId as string, postId);
  res.status(200).json(result);
});

// DELETE /feed/posts/:postId/like
export const unlikePost = asyncHandler(async (req: Request, res: Response) => {
  const postId = String(req.params.postId);
  const result = await feedService.unlikePost(req.userId as string, postId);
  res.status(200).json(result);
});

// GET /feed/posts/:postId/comments?limit=20&before=...
export const listComments = asyncHandler(async (req: Request, res: Response) => {
  const postId = String(req.params.postId);
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const before = req.query.before ? String(req.query.before) : undefined;

  const comments = await feedService.listComments(req.userId as string, postId, { limit, before });
  res.status(200).json(comments);
});

// POST /feed/posts/:postId/comments
export const createComment = asyncHandler(async (req: Request, res: Response) => {
  const postId = String(req.params.postId);
  const { content, parentCommentId } = req.body as CreateCommentPayload;

  const comment = await feedService.createComment(req.userId as string, postId, { content, parentCommentId });
  res.status(201).json(comment);
});

// PATCH /feed/comments/:commentId
export const updateComment = asyncHandler(async (req: Request, res: Response) => {
  const commentId = String(req.params.commentId);
  const { content } = req.body as { content: string };

  const comment = await feedService.updateComment(req.userId as string, commentId, content);
  res.status(200).json(comment);
});

// DELETE /feed/comments/:commentId
export const deleteComment = asyncHandler(async (req: Request, res: Response) => {
  const commentId = String(req.params.commentId);
  await feedService.deleteComment(req.userId as string, commentId);
  res.status(204).send();
});

// POST /feed/comments/:commentId/like
export const likeComment = asyncHandler(async (req: Request, res: Response) => {
  const commentId = String(req.params.commentId);
  const result = await feedService.likeComment(req.userId as string, commentId);
  res.status(200).json(result);
});

// DELETE /feed/comments/:commentId/like
export const unlikeComment = asyncHandler(async (req: Request, res: Response) => {
  const commentId = String(req.params.commentId);
  const result = await feedService.unlikeComment(req.userId as string, commentId);
  res.status(200).json(result);
});