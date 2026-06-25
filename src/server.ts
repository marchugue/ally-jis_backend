import app from './app';
import { env } from './config/env';

process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 unhandledRejection:', reason);
});

const server = app.listen(env.PORT, () => {
  console.log(`Ally-jis API: http://localhost:${env.PORT}/api`);
  console.log(`Health check:  http://localhost:${env.PORT}/api/health/supabase`);
  console.log('✅ Server is listening, process should stay alive');
});

server.on('error', (err) => {
  console.error('💥 Server error:', err);
});

// Keep process alive
process.stdin.resume();