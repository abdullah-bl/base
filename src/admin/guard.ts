import { timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'
import { getAuth } from '../auth/auth.js'
import { apiKeyHasScope, verifyApiKey } from '../auth/api-keys.js'
import env from '../env.js'

export type AdminActor =
  | { kind: 'user'; userId: string; email?: string; role: string }
  | { kind: 'token' }
  | { kind: 'api_key'; keyId: string; scopes: string[] }

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Require admin access via:
 * - session role=admin
 * - X-Admin-Token matching ADMIN_TOKEN (break-glass)
 * - Bearer API key with `admin` or `*` scope
 */
export async function requireAdmin(c: Context, next: Next) {
  const tokenHeader = c.req.header('X-Admin-Token')
  if (tokenHeader && env.ADMIN_TOKEN) {
    if (safeEqual(tokenHeader, env.ADMIN_TOKEN)) {
      c.set('adminActor' as never, { kind: 'token' } as never)
      c.set('user' as never, {
        id: 'admin-token',
        role: 'admin',
        name: 'Admin Token',
        email: 'admin-token@local',
      } as never)
      await next()
      return
    }
  }

  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const raw = authHeader.slice(7).trim()
    if (raw.startsWith('base_')) {
      const apiUser = await verifyApiKey(raw)
      if (apiUser && apiKeyHasScope(apiUser.scopes, 'admin')) {
        c.set('user', apiUser as never)
        c.set('adminActor' as never, {
          kind: 'api_key',
          keyId: apiUser.id,
          scopes: apiUser.scopes,
        } as never)
        await next()
        return
      }
      if (apiUser) {
        return c.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'API key missing admin scope',
            },
          },
          403,
        )
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

  const user = (session as any).user as {
    id: string
    email?: string
    role?: string
  }
  if (user?.role !== 'admin') {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      403,
    )
  }

  c.set('session', session as never)
  c.set('user', user as never)
  c.set('adminActor' as never, {
    kind: 'user',
    userId: user.id,
    email: user.email,
    role: user.role,
  } as never)

  await next()
}

export function getAdminActor(c: Context): AdminActor {
  return (
    (c.get('adminActor' as never) as AdminActor | undefined) ?? {
      kind: 'token',
    }
  )
}
