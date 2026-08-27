import { Router } from 'express';
import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import profileRoutes from './profile.routes';
import lookupRoutes from './lookup.routes';
import interactionRoutes from './interaction.routes';
import conversationRoutes from './conversation.routes';
import notificationRoutes from './notification.routes';
import mediaRoutes from './media.routes';
import presenceRoutes from './presence.routes';
import feedRoutes from './feed.routes';
import moderationRoutes from './moderation.routes';
import matchRoutes from './matchmaking.routes';
import followRoutes from './follow.routes';
import adminRoutes from './admin.routes';
import { maintenanceMiddleware } from '../app/middleware/maintenance.middleware';

const router = Router();

router.use(maintenanceMiddleware);

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/lookups', lookupRoutes);
router.use('/profiles', profileRoutes);
router.use('/interactions', interactionRoutes);
router.use('/conversations', conversationRoutes);
router.use('/notifications', notificationRoutes);
router.use('/media', mediaRoutes);
router.use('/presence', presenceRoutes);
router.use('/feed', feedRoutes);
router.use('/moderation', moderationRoutes);
router.use('/match', matchRoutes);
router.use('/follows', followRoutes);
router.use('/admin', adminRoutes);

export default router;