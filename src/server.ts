import http from 'http';
import app from './app';
import { env } from './config/env';
import { initRedis, closeRedis } from './config/redis';
import { initSockets } from './sockets';
import { reconcileStaleMatches } from './app/services/matchmaking.service';

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

async function bootstrap() {
  // Initialize Redis client and adapter if REDIS_URL is configured
  await initRedis();

  // Wrap the Express app in a raw http.Server so Socket.io can attach to the
  // same port instead of needing a separate one.
  const server = http.createServer(app);
  initSockets(server);

  server.listen(env.PORT, () => {
    console.log(`Ally-jis API: http://localhost:${env.PORT}/api`);
    console.log(`Health check:  http://localhost:${env.PORT}/api/health/supabase`);
    console.log('Server is listening, process should stay alive');

    // Safety net: in-memory matchmaking timers don't survive a restart, so
    // sweep for anything past its deadline on boot.
    reconcileStaleMatches().catch((err) => console.error('reconcileStaleMatches failed:', err));
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
  });

  const shutdown = async () => {
    console.log('Gracefully shutting down...');
    await closeRedis();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Keep process alive
  process.stdin.resume();
}

void bootstrap();