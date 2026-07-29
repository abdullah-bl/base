import type { Context, Next } from 'hono'
import env from '../env.js'
import { getCachedRuntimeOrEnv } from '../settings/resolve.js'

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

function limits() {
  const cached = getCachedRuntimeOrEnv()
  return {
    enabled:
      typeof cached.rateLimitEnabled === 'boolean'
        ? cached.rateLimitEnabled
        : env.RATE_LIMIT_ENABLED,
    windowMs: cached.rateLimitWindowMs ?? env.RATE_LIMIT_WINDOW_MS,
    max: cached.rateLimitMax ?? env.RATE_LIMIT_MAX,
    authMax: cached.rateLimitAuthMax ?? env.RATE_LIMIT_AUTH_MAX,
  }
}

export async function rateLimitMiddleware(c: Context, next: Next) {
  const cfg = limits()
  if (!cfg.enabled) {
    await next()
    return
  }

  const isAuth = c.req.path.startsWith('/api/auth/')
  const isOnboarding = c.req.path.startsWith('/api/admin/onboarding/')
  const isRestart = c.req.path.startsWith('/api/admin/system/restart')
  const max = isRestart
    ? 5
    : isOnboarding
      ? Math.min(10, cfg.authMax)
      : isAuth
        ? cfg.authMax
        : cfg.max
  const windowMs = cfg.windowMs
  const key = getKey(
    c,
    isRestart ? 'restart' : isOnboarding ? 'onboarding' : isAuth ? 'auth' : 'api',
  )
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
