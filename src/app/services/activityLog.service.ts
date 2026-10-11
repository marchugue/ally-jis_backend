// src/app/services/activityLog.service.ts
//
// Service layer for Facebook-style User Activity Log.
// Provides non-blocking activity logging and chronological date-grouped views.

import type { Request } from 'express';
import * as activityLogModel from '../models/activityLog.model';
import type { ActivityBucket, ActivityLogRow, ListActivityLogsParams } from '../models/activityLog.model';

export interface RecordActivityOptions {
  userId: string;
  bucket: ActivityBucket;
  action: string;
  title: string;
  summary?: string | null;
  targetType?: 'post' | 'profile' | 'comment' | 'security' | 'settings';
  targetId?: string | null;
  metadata?: Record<string, any>;
  req?: Request;
  deviceInfo?: string;
  ipAddress?: string;
}

export interface ActivityGroup {
  dateLabel: string; // 'Today', 'Yesterday', 'This Week', 'This Month', or month/year e.g. 'October 2026'
  dateKey: string;   // YYYY-MM-DD
  items: ActivityLogRow[];
}

export interface FormattedActivityResponse {
  items: ActivityLogRow[];
  groups: ActivityGroup[];
  nextCursor?: string;
  totalCount: number;
}

/**
 * Extracts a friendly device descriptor from Express request headers.
 */
function parseDeviceDescriptor(req?: Request, explicitDevice?: string): string {
  if (explicitDevice) return explicitDevice;
  if (!req) return 'Unknown Device';

  const userAgent = req.headers['user-agent'] || '';
  const isMobileClient = req.headers['x-client-platform'] === 'mobile' || /okhttp|expo|reactnative|android|iphone|ipad/i.test(userAgent);

  if (/android/i.test(userAgent)) {
    return isMobileClient ? 'Ally Mobile (Android)' : 'Chrome on Android';
  }
  if (/iphone|ipad/i.test(userAgent)) {
    return isMobileClient ? 'Ally Mobile (iOS)' : 'Safari on iOS';
  }
  if (/windows/i.test(userAgent)) {
    return 'Chrome on Windows';
  }
  if (/macintosh|mac os x/i.test(userAgent)) {
    return 'Safari on macOS';
  }
  if (/linux/i.test(userAgent)) {
    return 'Browser on Linux';
  }
  return isMobileClient ? 'Ally Mobile' : 'Web Browser';
}

/**
 * Extracts sanitized client IP from Express request.
 */
function extractClientIp(req?: Request, explicitIp?: string): string | undefined {
  if (explicitIp) return explicitIp;
  if (!req) return undefined;

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].trim();
  }
  return req.socket?.remoteAddress;
}

/**
 * Helper to compute Facebook-style chronological section header.
 */
function getDateLabel(dateIso: string): { label: string; dateKey: string } {
  const date = new Date(dateIso);
  const now = new Date();

  const dateKey = date.toISOString().slice(0, 10);
  const nowKey = now.toISOString().slice(0, 10);

  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (dateKey === nowKey) {
    return { label: 'Today', dateKey };
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dateKey === yesterday.toISOString().slice(0, 10)) {
    return { label: 'Yesterday', dateKey };
  }

  if (diffDays < 7) {
    return { label: 'This Week', dateKey };
  }

  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
    return { label: 'This Month', dateKey };
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return {
    label: `${monthNames[date.getMonth()]} ${date.getFullYear()}`,
    dateKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
  };
}

/**
 * Non-blocking logger: Records an event in the user's activity log.
 * Never throws or slows down caller mutation workflows.
 */
export function recordActivity(options: RecordActivityOptions): void {
  const {
    userId,
    bucket,
    action,
    title,
    summary,
    targetType,
    targetId,
    metadata,
    req,
    deviceInfo,
    ipAddress,
  } = options;

  if (!userId) return;

  const finalDevice = parseDeviceDescriptor(req, deviceInfo);
  const finalIp = extractClientIp(req, ipAddress);

  // Fire-and-forget promise
  activityLogModel.createActivityLog({
    userId,
    bucket,
    action,
    title,
    summary,
    targetType,
    targetId,
    deviceInfo: finalDevice,
    ipAddress: finalIp,
    metadata,
  }).catch((err) => {
    console.warn('[ActivityLog] Non-critical error recording activity:', err?.message);
  });
}

/**
 * Retrieves user activity logs grouped into Facebook-style chronological blocks.
 */
export async function getUserActivityLogs(
  userId: string,
  params: ListActivityLogsParams = {}
): Promise<FormattedActivityResponse> {
  const { items, nextCursor } = await activityLogModel.listUserActivityLogs(userId, params);

  // Group items chronologically
  const groupsMap = new Map<string, { dateLabel: string; dateKey: string; items: ActivityLogRow[] }>();

  for (const item of items) {
    const { label, dateKey } = getDateLabel(item.created_at);
    const existing = groupsMap.get(label);
    if (existing) {
      existing.items.push(item);
    } else {
      groupsMap.set(label, {
        dateLabel: label,
        dateKey,
        items: [item],
      });
    }
  }

  const groups = Array.from(groupsMap.values());

  return {
    items,
    groups,
    nextCursor,
    totalCount: items.length,
  };
}

/**
 * Deletes a specific activity log entry.
 */
export async function deleteUserActivityLog(userId: string, logId: string): Promise<boolean> {
  return activityLogModel.deleteUserActivityLog(userId, logId);
}

/**
 * Clears user activity logs for a specific bucket or all buckets.
 */
export async function clearUserActivityLogs(
  userId: string,
  bucket?: ActivityBucket
): Promise<boolean> {
  return activityLogModel.clearUserActivityLogs(userId, bucket);
}
