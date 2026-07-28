import { timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'
import { getAuth } from '../auth/auth.js'
import env from '../env.js'

export type AdminActor =
  | { kind: 'user'; userId: string; email?: string; role: string }
  | { kind: 'token' }

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Require admin access via session role=admin OR X-Admin-Token matching ADMIN_TOKEN.
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
