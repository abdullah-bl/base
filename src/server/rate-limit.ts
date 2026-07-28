import type { Context, Next } from 'hono'
import env from '../env.js'

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function getKey(c: Context, prefix: string): string {
  const user = c.get('user' as never) as { id?: string } | undefined
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  return `${prefix}:${user?.id || ip}`
}

function take(key: string, max: number, windowMs: number): {
  allowed: boolean
  remaining: number
  resetAt: number
} {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  const remaining = Math.max(0, max - bucket.count)
  return {
    allowed: bucket.count <= max,
    remaining,
    resetAt: bucket.resetAt,
  }
}

export async function rateLimitMiddleware(c: Context, next: Next) {
  if (!env.RATE_LIMIT_ENABLED) {
    await next()
    return
  }

  const isAuth = c.req.path.startsWith('/api/auth/')
  const max = isAuth ? env.RATE_LIMIT_AUTH_MAX : env.RATE_LIMIT_MAX
  const windowMs = env.RATE_LIMIT_WINDOW_MS
  const key = getKey(c, isAuth ? 'auth' : 'api')
  const result = take(key, max, windowMs)

  c.header('X-RateLimit-Limit', String(max))
  c.header('X-RateLimit-Remaining', String(result.remaining))
  c.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)))

  if (!result.allowed) {
    return c.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please retry later.',
        },
      },
      429,
    )
  }

  await next()
}

export function resetRateLimitForTests(): void {
  buckets.clear()
}
