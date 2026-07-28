import { ulid } from 'ulid'
import type { Context, Next } from 'hono'
import env from '../env.js'
import { logger } from './logger.js'

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
  }
}

export async function requestLogMiddleware(c: Context, next: Next) {
  const requestId = c.req.header('X-Request-ID') || ulid()
  c.set('requestId', requestId)
  c.header('X-Request-ID', requestId)

  const path = c.req.path
  // Avoid feedback loop on log stream
  const skip =
    path.includes('/api/admin/logs/stream') ||
    path.includes('/api/realtime')

  const start = Date.now()
  try {
    await next()
  } finally {
    if (!skip) {
      const user = c.get('user' as never) as { id?: string } | undefined
      const durationMs = Date.now() - start
      const status = c.res.status
      const level =
        status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'

      logger.emit({
        id: ulid(),
        ts: Date.now(),
        level,
        kind: 'http',
        message: `${c.req.method} ${path} ${status}`,
        method: c.req.method,
        path,
        status,
        durationMs,
        requestId,
        userId: user?.id,
        ip:
          c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
          c.req.header('x-real-ip') ||
          undefined,
        userAgent: c.req.header('user-agent') || undefined,
      })
    }
  }
}

export function getRequestId(c: Context): string | undefined {
  try {
    return c.get('requestId')
  } catch {
    return undefined
  }
}

// Silence unused env import warning when tree-shaken oddly — env used via logger
void env
