import type { Context, Next } from 'hono'
import { getAuth } from './auth.js'
import { verifyApiKey } from './api-keys.js'

/**
 * Require authentication — returns 401 if no session and no valid API key
 */
export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token.startsWith('base_')) {
      const apiUser = await verifyApiKey(token)
      if (apiUser) {
        c.set('user', apiUser as never)
        c.set('session', { user: apiUser } as never)
        c.set('authKind' as never, 'api_key' as never)
        await next()
        return
      }
    }
  }

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
  c.set('authKind' as never, 'session' as never)
  await next()
}

/**
 * Optional authentication — attaches session if present, doesn't block
 */
export async function optionalAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token.startsWith('base_')) {
      const apiUser = await verifyApiKey(token)
      if (apiUser) {
        c.set('user', apiUser as never)
        c.set('session', { user: apiUser } as never)
        c.set('authKind' as never, 'api_key' as never)
        await next()
        return
      }
    }
  }

  const session = await getAuth().api.getSession({
    headers: c.req.raw.headers,
  })

  if (session) {
    c.set('session', session as never)
    c.set('user', (session as any).user as never)
    c.set('authKind' as never, 'session' as never)
  }

  await next()
}
