// src/routes/matchmaking.routes.ts
//
// Mount this in your routes/index.ts:
//   import matchmakingRoutes from '../src/routes/matchmaking.routes';
//   router.use('/matchmaking', matchmakingRoutes);
//
// ⚠️ Adjust the authMiddleware import path below — I couldn't confirm
// exactly where it lives (auth.middleware.ts's own import pattern
// suggested src/middleware/, but error.middleware.ts's suggested a
// separate root-level app/middleware/ folder). Point it at whichever
// file exports `authMiddleware`.

import { Router } from 'express';
import * as matchmakingController from '../app/controller/matchmaking.controller';
import * as matchRevealController from '../app/controller/matchReveal.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

router.post('/queue', matchmakingController.joinQueue);
router.delete('/queue', matchmakingController.leaveQueue);
router.get('/status', matchmakingController.getStatus);
router.post('/:matchId/accept', matchmakingController.acceptMatch);
router.post('/:matchId/decline', matchmakingController.declineMatch);
router.post('/:matchId/end', matchmakingController.endMatch);
router.get('/:matchId/reveal', matchRevealController.getReveal);
router.get('/:matchId/timeline', matchRevealController.getTimeline);

export default router;