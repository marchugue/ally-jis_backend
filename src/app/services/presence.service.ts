import * as presenceModel from '../models/presence.model';
import type { OnlineUsersResponse } from '../types/presence.types';

/**
 * POST /presence/heartbeat
 */
export async function heartbeat(userId: string, platform?: string): Promise<void> {
  await presenceModel.recordHeartbeat(userId, platform);
}

/**
 * GET /presence/online
 */
export async function listOnline(): Promise<OnlineUsersResponse> {
  const [userIds, gameUserIds] = await Promise.all([
    presenceModel.findOnlineUserIds(),
    presenceModel.findGameOnlineUserIds(),
  ]);

  return {
    userIds,
    gameUserIds,
    gameCount: gameUserIds.length,
    online: userIds.map((id) => ({ user_id: id, last_seen: new Date().toISOString() })),
  };
}
