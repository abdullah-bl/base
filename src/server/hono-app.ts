import { Hono } from 'hono';
import { corsMiddleware } from './cors.js';
import { errorHandler } from './error-handler.js';
import env from '../env.js';

const app = new Hono();

// Apply CORS middleware
app.use('*', corsMiddleware);

// Apply error handler
app.onError(errorHandler);

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    uptime: process.uptime(),
  });
});

export default app;