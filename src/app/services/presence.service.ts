import * as presenceModel from '../models/presence.model';
import * as realtimeService from './realtime.service';
import type {
  OnlineUsersResponse,
  PlatformType,
  PresenceEventPayload,
  PresenceWebhookPayload,
} from '../types/presence.types';

// Map of userId -> Map of socketId -> { platform: PlatformType; connectedAt: number }
const userSockets = new Map<string, Map<string, { platform: PlatformType; connectedAt: number }>>();

// Grace period timers for socket disconnects (avoids flapping on page refreshes)
const disconnectTimers = new Map<string, NodeJS.Timeout>();

const DISCONNECT_GRACE_MS = 4000;

/**
 * Dispatches an outgoing webhook to external monitoring or platform systems
 * if PRESENCE_WEBHOOK_URL is configured in environment variables.
 */
export async function dispatchPresenceWebhook(
  event: 'presence:online' | 'presence:offline',
  userId: string,
  platform?: PlatformType
): Promise<void> {
  const webhookUrl = process.env.PRESENCE_WEBHOOK_URL || process.env.WEBHOOK_URL;
  if (!webhookUrl) return;

  const payload: PresenceEventPayload = {
    userId,
    platform: platform || 'web',
    status: event === 'presence:online' ? 'online' : 'offline',
    timestamp: new Date().toISOString(),
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const secret = process.env.PRESENCE_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Ally-JIS-Presence-Webhook/1.0',
    };
    if (secret) {
      headers['x-webhook-secret'] = secret;
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event,
        data: payload,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err: any) {
    console.warn('[Presence Webhook] Outgoing dispatch error:', err?.message || err);
  }
}

/**
 * Broadcast presence change event to all connected sockets across all platforms.
 */
function broadcastPresence(event: 'presence:online' | 'presence:offline', userId: string, platform?: PlatformType) {
  const payload: PresenceEventPayload = {
    userId,
    platform: platform || 'web',
    status: event === 'presence:online' ? 'online' : 'offline',
    timestamp: new Date().toISOString(),
  };

  realtimeService.broadcast(event, payload);
  realtimeService.broadcast('presence:change', payload);
  void dispatchPresenceWebhook(event, userId, platform);
}

/**
 * Handle new socket connection.
 */
export async function handleSocketConnect(
  userId: string,
  socketId: string,
  platform?: string
): Promise<void> {
  if (!userId) return;

  // Clear any pending disconnect timer for this user
  const existingTimer = disconnectTimers.get(userId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    disconnectTimers.delete(userId);
  }

  const normalized = presenceModel.normalizePlatform(platform);
  let sockets = userSockets.get(userId);
  const wasOnline = Boolean(sockets && sockets.size > 0);

  if (!sockets) {
    sockets = new Map();
    userSockets.set(userId, sockets);
  }
  sockets.set(socketId, { platform: normalized, connectedAt: Date.now() });

  await presenceModel.recordHeartbeat(userId, normalized);

  // If user transitioned from offline to online, announce immediately
  if (!wasOnline) {
    broadcastPresence('presence:online', userId, normalized);
  }
}

/**
 * Handle socket disconnection with a short grace period.
 */
export function handleSocketDisconnect(userId: string, socketId: string): void {
  if (!userId) return;

  const sockets = userSockets.get(userId);
  if (!sockets) return;

  const meta = sockets.get(socketId);
  const platform = meta?.platform || 'web';
  sockets.delete(socketId);

  if (sockets.size === 0) {
    userSockets.delete(userId);

    // Schedule offline marking after grace period
    const timer = setTimeout(async () => {
      disconnectTimers.delete(userId);

      // Check if user reconnected on any platform in the meantime
      const currentSockets = userSockets.get(userId);
      if (currentSockets && currentSockets.size > 0) return;

      await presenceModel.recordOffline(userId);
      broadcastPresence('presence:offline', userId, platform);
    }, DISCONNECT_GRACE_MS);

    disconnectTimers.set(userId, timer);
  }
}

/**
 * POST /presence/heartbeat
 */
export async function heartbeat(userId: string, platform?: string): Promise<void> {
  if (!userId) return;
  const isCurrentlyOnline = await presenceModel.isUserOnline(userId);
  const normalized = presenceModel.normalizePlatform(platform);

  await presenceModel.recordHeartbeat(userId, normalized);

  if (!isCurrentlyOnline) {
    broadcastPresence('presence:online', userId, normalized);
  }
}

/**
 * Force mark user as offline.
 */
export async function setOffline(userId: string): Promise<void> {
  if (!userId) return;
  const timer = disconnectTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(userId);
  }
  userSockets.delete(userId);
  await presenceModel.recordOffline(userId);
  broadcastPresence('presence:offline', userId, 'web');
}

/**
 * Process incoming presence webhook from external services, Supabase Database Webhook,
 * or other platform servers.
 */
export async function handlePresenceWebhook(payload: PresenceWebhookPayload): Promise<{
  success: boolean;
  message: string;
  processedCount: number;
}> {
  let processedCount = 0;

  // 1. Batch format
  if (Array.isArray(payload.events) && payload.events.length > 0) {
    for (const item of payload.events) {
      if (!item.userId) continue;
      const normalized = presenceModel.normalizePlatform(item.platform);
      if (item.status === 'offline') {
        await presenceModel.recordOffline(item.userId);
        broadcastPresence('presence:offline', item.userId, normalized);
      } else {
        await presenceModel.recordHeartbeat(item.userId, normalized);
        broadcastPresence('presence:online', item.userId, normalized);
      }
      processedCount++;
    }
    return { success: true, message: `Processed ${processedCount} batch events`, processedCount };
  }

  // 2. Supabase Database Webhook format
  if (payload.table === 'user_presence') {
    const userId = payload.record?.user_id || payload.old_record?.user_id;
    if (userId) {
      const platform = presenceModel.normalizePlatform(payload.record?.platform);
      if (payload.type === 'DELETE') {
        await presenceModel.recordOffline(userId);
        broadcastPresence('presence:offline', userId, platform);
      } else {
        await presenceModel.recordHeartbeat(userId, platform);
        broadcastPresence('presence:online', userId, platform);
      }
      return { success: true, message: `Processed Supabase ${payload.type} webhook`, processedCount: 1 };
    }
  }

  // 3. Generic presence webhook event
  const targetUserId = payload.userId || payload.record?.user_id;
  if (!targetUserId) {
    return { success: false, message: 'Missing userId in payload', processedCount: 0 };
  }

  const platform = presenceModel.normalizePlatform(payload.platform || payload.record?.platform);
  const isOffline =
    payload.status === 'offline' ||
    payload.event === 'presence:offline' ||
    payload.type === 'DELETE';

  if (isOffline) {
    await presenceModel.recordOffline(targetUserId);
    broadcastPresence('presence:offline', targetUserId, platform);
  } else {
    await presenceModel.recordHeartbeat(targetUserId, platform);
    broadcastPresence('presence:online', targetUserId, platform);
  }

  return { success: true, message: 'Processed presence webhook', processedCount: 1 };
}

/**
 * GET /presence/online
 */
export async function listOnline(): Promise<OnlineUsersResponse> {
  const [userIds, gameUserIds, webUserIds, appUserIds] = await Promise.all([
    presenceModel.findOnlineUserIds(),
    presenceModel.findGameOnlineUserIds(),
    presenceModel.findWebOnlineUserIds(),
    presenceModel.findAppOnlineUserIds(),
  ]);

  return {
    userIds,
    gameUserIds,
    gameCount: gameUserIds.length,
    webUserIds,
    webCount: webUserIds.length,
    appUserIds,
    appCount: appUserIds.length,
    online: userIds.map((id) => ({ user_id: id, last_seen: new Date().toISOString() })),
  };
}
