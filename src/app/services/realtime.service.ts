// src/app/services/realtime.service.ts
//
// One shared place that owns the Socket.io server reference and the
// user:<id> room convention. Originally lived inside matchmaking.service.ts
// (it was the only thing using sockets); pulled out once conversation.service.ts
// needed real-time delivery too, so there's a single real-time layer instead
// of two.

import type { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;

/** Called once at startup by src/sockets/index.ts. Kept as a module-level
 * setter (rather than importing socket setup here) to avoid a circular
 * import between the socket layer and the services that emit through it. */
export function attachSocketServer(server: SocketIOServer): void {
  io = server;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}
