import * as presenceModel from '../models/presence.model';
import type { OnlineUsersResponse } from '../types/presence.types';

/**
 * POST /presence/heartbeat
 */
export async function heartbeat(userId: string): Promise<void> {
  await presenceModel.recordHeartbeat(userId);
}

/**
 * GET /presence/online
 */
export async function listOnline(): Promise<OnlineUsersResponse> {
  const userIds = await presenceModel.findOnlineUserIds();
  return { userIds };
}
