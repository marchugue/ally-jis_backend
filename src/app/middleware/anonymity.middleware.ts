import type { Request, Response, NextFunction } from 'express';
import { findAcceptedConnectionIds } from '../models/feed.model';
import { getDeterministicAnonymousAvatar } from '../constants/anonymousIdentity';

/**
 * Universal Anonymity Middleware
 *
 * Intercepts res.json responses across all endpoints.
 * If any object in the outgoing response contains user/profile information
 * for a user who is NOT the caller and NOT a confirmed ally,
 * it masks their identity to enforce complete end-to-end anonymity.
 */
export function anonymityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: any): Response {
    if (!body || typeof body !== 'object') {
      return originalJson(body);
    }

    const callerId = (req as any).userId as string | undefined;

    const handleAnonymization = async () => {
      let allyIds: Set<string>;
      if (res.locals?.allyIds) {
        allyIds = res.locals.allyIds;
      } else if (callerId) {
        try {
          allyIds = await findAcceptedConnectionIds(callerId);
          if (res.locals) res.locals.allyIds = allyIds;
        } catch {
          allyIds = new Set<string>();
        }
      } else {
        allyIds = new Set<string>();
      }

      const visited = new WeakSet();
      return sanitizePayload(body, callerId, allyIds, visited);
    };

    handleAnonymization()
      .then((sanitized) => {
        originalJson(sanitized);
      })
      .catch((err) => {
        console.error('[AnonymityMiddleware] Error during response sanitization:', err);
        originalJson(body);
      });

    return res;
  };

  next();
}

/**
 * Recursively inspects and sanitizes user data within payload objects.
 */
function sanitizePayload(
  data: any,
  callerId: string | undefined,
  allyIds: Set<string>,
  visited: WeakSet<object>
): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (visited.has(data)) {
    return data;
  }
  visited.add(data);

  if (Array.isArray(data)) {
    return data.map((item) => sanitizePayload(item, callerId, allyIds, visited));
  }

  // Check if current object represents a user / profile / author
  const userId = data.id || data.user_id || data.userId || data.from_user_id || data.author_id;
  const hasUserFields =
    typeof data.full_name !== 'undefined' ||
    typeof data.fullName !== 'undefined' ||
    typeof data.author_name !== 'undefined' ||
    typeof data.username !== 'undefined' ||
    typeof data.avatar_url !== 'undefined' ||
    typeof data.avatarUrl !== 'undefined';

  if (userId && typeof userId === 'string' && hasUserFields) {
    const isSelf = callerId && userId === callerId;
    const isAlly = callerId && allyIds.has(userId);

    if (isSelf || isAlly) {
      if ('is_ally' in data) data.is_ally = isAlly;
      if ('isAlly' in data) data.isAlly = isAlly;
    } else {
      // Non-ally user: mask identity
      if ('full_name' in data) data.full_name = 'Anonymous Peer';
      if ('fullName' in data) data.fullName = 'Anonymous Peer';
      if ('author_name' in data) data.author_name = 'Anonymous Peer';
      if ('username' in data) data.username = 'anonymous';
      if ('avatar_url' in data) data.avatar_url = null;
      if ('avatarUrl' in data) data.avatarUrl = null;
      if ('user_avatar' in data) data.user_avatar = null;
      if ('bio' in data) data.bio = null;
      if ('department' in data) data.department = null;
      if ('is_ally' in data) data.is_ally = false;
      if ('isAlly' in data) data.isAlly = false;
      data.avatarKey = getDeterministicAnonymousAvatar(userId);

      // Strip sensitive PII
      delete data.email;
      delete data.phone_number;
      delete data.student_id;
      delete data.id_photo_url;
      delete data.id_back_photo_url;
    }
  }

  // Recurse on all object keys
  for (const key of Object.keys(data)) {
    if (data[key] && typeof data[key] === 'object') {
      data[key] = sanitizePayload(data[key], callerId, allyIds, visited);
    }
  }

  return data;
}
