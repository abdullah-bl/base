import { cors } from 'hono/cors';
import env from '../env.js';

// Parse CORS origins from environment
function parseCorsOrigins(): string[] | string {
  const origins = env.CORS_ORIGINS.trim();
  if (origins === '*') {
    return '*';
  }
  return origins.split(',').map(o => o.trim()).filter(Boolean);
}

export const corsMiddleware = cors({
  origin: parseCorsOrigins(),
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400, // 24 hours
});