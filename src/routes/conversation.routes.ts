// src/routes/conversation.routes.ts
//
// ROUTE LAYER
// -----------
// Declares the URL + HTTP method, attaches middleware, calls the
// controller. No logic lives here.
//
// IMPORTANT: static paths (/memberships/me, /with-user/:otherUserId) must
// be registered BEFORE the dynamic /:id route, or Express will treat
// "memberships" / "with-user" as a conversation id.

import { Router } from 'express';
import * as conversationController from '../app/controller/conversation.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

// GET /api/conversations/memberships/me
router.get('/memberships/me', conversationController.myMemberships);

// GET /api/conversations/with-user/:otherUserId
router.get('/with-user/:otherUserId', conversationController.getWithUser);

// GET /api/conversations
router.get('/', conversationController.list);

// POST /api/conversations
router.post('/', conversationController.create);

// GET /api/conversations/:id
router.get('/:id', conversationController.getById);

// DELETE /api/conversations/:id — hide from my chat list (not a real delete)
router.delete('/:id', conversationController.hide);

// POST /api/conversations/:id/clear — permanently clear history for this user
router.post('/:id/clear', conversationController.clear);

// POST /api/conversations/:id/unhide — undo
router.post('/:id/unhide', conversationController.unhide);

// PATCH /api/conversations/:id/read
router.patch('/:id/read', conversationController.markRead);

// GET /api/conversations/:id/messages
router.get('/:id/messages', conversationController.listMessages);

// POST /api/conversations/:id/messages
router.post('/:id/messages', conversationController.sendMessage);

// PUT /api/conversations/:id/messages/:messageId/reactions
router.put('/:id/messages/:messageId/reactions', conversationController.setMessageReaction);

// DELETE /api/conversations/:id/messages/:messageId
// Body: { mode: 'delete_for_me' | 'delete_for_everyone' }
router.delete('/:id/messages/:messageId', conversationController.deleteMessage);

// PATCH /api/conversations/:id/icebreakers
router.patch('/:id/icebreakers', conversationController.updateIcebreakersEnabled);

// GET /api/conversations/:id/icebreakers
router.get('/:id/icebreakers', conversationController.getIcebreakersEnabled);

export default router;
