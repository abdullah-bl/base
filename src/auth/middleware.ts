import type { Context, Next } from 'hono'
import { getAuth } from './auth.js'

/**
 * Require authentication — returns 401 if no session
 */
export async function requireAuth(c: Context, next: Next) {
  const session = await getAuth().api.getSession({
    headers: c.req.raw.headers,
  })

  if (!session) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      401,
    )
  }

  c.set('session', session as never)
  c.set('user', (session as any).user as never)
  await next()
}

/**
 * Optional authentication — attaches session if present, doesn't block
 */
export async function optionalAuth(c: Context, next: Next) {
  const session = await getAuth().api.getSession({
    headers: c.req.raw.headers,
  })

  if (session) {
    c.set('session', session as never)
    c.set('user', (session as any).user as never)
  }

  await next()
}
