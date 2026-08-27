import http from 'http';
import app from './app';
import { env } from './config/env';
import { initSockets } from './sockets';
import { reconcileStaleMatches } from './app/services/matchmaking.service';

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

// Wrap the Express app in a raw http.Server so Socket.io can attach to the
// same port instead of needing a separate one.
const server = http.createServer(app);
initSockets(server);

server.listen(env.PORT, () => {
  console.log(`Ally-jis API: http://localhost:${env.PORT}/api`);
  console.log(`Health check:  http://localhost:${env.PORT}/api/health/supabase`);
  console.log('Server is listening, process should stay alive');

  // Safety net: in-memory matchmaking timers don't survive a restart, so
  // sweep for anything past its deadline on boot. See
  // app/services/matchTimers.ts for why this is in-memory in the first place.
  reconcileStaleMatches().catch((err) => console.error('reconcileStaleMatches failed:', err));
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

// Keep process alive
process.stdin.resume();