// src/routes/game.routes.ts
//
// ROUTE LAYER — 2-player game invites, sessions and leaderboard.
// Requires supabase/migrations/028_game_multiplayer.sql.
// Live play (moves, state, rematch) happens over Socket.io — see sockets/index.ts.

import { Router } from 'express';
import * as gameController from '../app/controller/game.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

// Static paths first so they are never swallowed by /:id
router.get('/open', gameController.open);
router.get('/leaderboard', gameController.leaderboard);
router.get('/me/stats', gameController.myStats);

router.post('/invite', gameController.invite);
router.post('/:id/accept', gameController.accept);
router.post('/:id/decline', gameController.decline);
router.post('/:id/cancel', gameController.cancel);
router.get('/:id', gameController.getOne);

export default router;
