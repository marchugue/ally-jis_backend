// src/sockets/index.ts
//
// Socket.io setup. Reuses your existing token-based auth (authModel.getUserFromToken)
// instead of introducing a new auth mechanism — the client passes the same
// Bearer access token it already sends on REST calls, via the `auth` option:
//   io(url, { auth: { token: accessToken } })
//
// Requires: npm install socket.io

import type { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import * as authModel from '../app/models/auth.model';
import { attachSocketServer } from '../app/services/realtime.service';
import { relayTyping } from '../app/services/conversation.service';
import * as gameService from '../app/services/game.service';
import { env } from '../config/env';
import { getRedisClient, getRedisSubClient } from '../config/redis';

export function initSockets(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // React Native / Expo often omit Origin — must allow for mobile sockets.
        if (!origin) return callback(null, true);
        if (
          env.WEB_URL === '*' ||
          origin === env.WEB_URL ||
          origin.startsWith('http://localhost:') ||
          origin.endsWith('.ally-jis.com') ||
          origin.endsWith('.ally-jis.xyz') ||
          origin === 'https://ally-jis.com'
        ) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    },
  });

  const pubClient = getRedisClient();
  const subClient = getRedisSubClient();
  if (pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient));
    console.info('[Sockets] Redis adapter attached for horizontal scaling.');
  } else {
    console.info('[Sockets] Running with local in-memory socket adapter.');
  }

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers.authorization?.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : undefined);

      const passwordResetTracking = socket.handshake.auth?.passwordResetTracking as string | undefined;

      if (!token && passwordResetTracking) {
        socket.data.passwordResetTracking = passwordResetTracking.trim();
        next();
        return;
      }

      if (!token) {
        next(new Error('Missing access token'));
        return;
      }

      const user = await authModel.getUserFromToken(token);
      if (!user) {
        next(new Error('Invalid or expired token'));
        return;
      }

      socket.data.userId = user.id;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const resetTracking = socket.data.passwordResetTracking as string | undefined;
    if (resetTracking) {
      socket.join(`password_reset:${resetTracking}`);
      return;
    }

    const userId = socket.data.userId as string;
    // All real-time events (matchmaking lifecycle + conversation
    // messages/typing) are emitted to `user:<id>` rooms — see
    // emitToUser() in realtime.service.ts.
    socket.join(`user:${userId}`);

    // Typing indicator for any conversation (regular or anonymous).
    // `fromUserId` is always the authenticated socket's own id (never
    // trust a client-supplied id) — relayTyping re-checks membership and
    // ignores the event entirely if this socket's user isn't actually a
    // member of the conversation.
    socket.on('conversation:typing', (payload: { conversationId?: string; isTyping?: boolean }) => {
      const conversationId = payload?.conversationId;
      if (!conversationId) return;
      void relayTyping(conversationId, userId, Boolean(payload?.isTyping));
    });

    // ── 2-player games ──────────────────────────────────────────────────
    // Every handler takes an optional ack callback and answers
    // { ok: true, ... } or { ok: false, message } — the server is the only
    // authority on game state; clients only ever send intents.
    type Ack = (response: Record<string, unknown>) => void;
    const respond = async (ack: Ack | undefined, work: () => Promise<Record<string, unknown> | void>) => {
      try {
        const extra = (await work()) ?? {};
        ack?.({ ok: true, ...extra });
      } catch (err: any) {
        ack?.({ ok: false, message: err?.message ?? 'Game error', status: err?.status ?? 500 });
      }
    };

    socket.on('game:join', (payload: { sessionId?: string }, ack?: Ack) => {
      void respond(ack, async () => {
        if (!payload?.sessionId) throw new Error('sessionId is required');
        const session = await gameService.joinSession(payload.sessionId, userId, socket.id);
        return { session };
      });
    });

    socket.on('game:move', (payload: { sessionId?: string; move?: unknown }, ack?: Ack) => {
      void respond(ack, async () => {
        if (!payload?.sessionId) throw new Error('sessionId is required');
        await gameService.handleMove(payload.sessionId, userId, payload.move);
      });
    });

    // Merge race: dedicated alias so clients can stream scores cheaply.
    socket.on('game:score', (payload: { sessionId?: string; score?: number; over?: boolean }, ack?: Ack) => {
      void respond(ack, async () => {
        if (!payload?.sessionId) throw new Error('sessionId is required');
        await gameService.handleMove(payload.sessionId, userId, {
          type: 'score',
          score: payload.score,
          over: payload.over,
        });
      });
    });

    socket.on('game:rematch', (payload: { sessionId?: string }, ack?: Ack) => {
      void respond(ack, async () => {
        if (!payload?.sessionId) throw new Error('sessionId is required');
        const session = await gameService.requestRematch(payload.sessionId, userId);
        return { started: Boolean(session), session };
      });
    });

    socket.on('game:leave', (payload: { sessionId?: string }, ack?: Ack) => {
      void respond(ack, async () => {
        if (!payload?.sessionId) throw new Error('sessionId is required');
        await gameService.leaveSession(payload.sessionId, userId);
      });
    });

    socket.on('disconnect', () => {
      gameService.handleSocketDisconnect(userId, socket.id);
    });
  });

  attachSocketServer(io);
  return io;
}