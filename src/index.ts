import { serve } from '@hono/node-server';
import app from './server/hono-app.js';
import env from './env.js';
import { db } from './db/client.js';

const PORT = env.PORT;

// Start server
const server = serve({
  fetch: app.fetch,
  port: PORT,
});

console.log('🚀 Base BaaS Server started');
console.log(`   Port: ${PORT}`);
console.log(`   Database: ${env.DATABASE_URL}`);
console.log(`   Version: 0.1.0`);
console.log('');
console.log('Health check: http://localhost:' + PORT + '/api/health');

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n📴 Received ${signal}, shutting down gracefully...`);
  server.close(async (err) => {
    if (err) {
      console.error('❌ Error closing server:', err);
      process.exit(1);
    }
    console.log('✅ Server closed successfully');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('❌ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});