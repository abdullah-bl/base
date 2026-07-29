import { cors } from 'hono/cors'
import env from '../env.js'

function parseCorsOrigins(): string | string[] | ((origin: string) => string | undefined | null) {
  const origins = env.CORS_ORIGINS.trim()
  if (origins === '*') {
    if (env.NODE_ENV === 'production') {
      throw new Error('CORS_ORIGINS=* is forbidden in production')
    }
    // Reflect request origin so credentials work in development
    return (origin: string) => origin || undefined
  }
  return origins.split(',').map((o) => o.trim()).filter(Boolean)
}

export const corsMiddleware = cors({
  origin: parseCorsOrigins(),
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'Last-Event-ID',
    'Accept',
    'X-Admin-Token',
  ],
  credentials: true,
  maxAge: 86400,
})
