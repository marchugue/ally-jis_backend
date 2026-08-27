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
import * as authModel from '../app/models/auth.model';
import { attachSocketServer } from '../app/services/realtime.service';
import { relayTyping } from '../app/services/conversation.service';
import { env } from '../../src/config/env';

export function initSockets(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.WEB_URL === '*' ? true : env.WEB_URL,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers.authorization?.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : undefined);

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
  });

  attachSocketServer(io);
  return io;
}