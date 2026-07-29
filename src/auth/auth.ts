import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { getDb, getClient } from '../db/client.js'
import { schema } from '../db/schema.js'
import env from '../env.js'
import { getEffectiveRuntime } from '../settings/resolve.js'
import { buildSocialProviders } from './oauth.js'
import {
  renderResetPasswordEmail,
  renderVerificationEmail,
  sendAuthEmail,
} from './email.js'

type AuthInstance = ReturnType<typeof betterAuth>

let authInstance: AuthInstance | null = null
let building: Promise<AuthInstance> | null = null

async function buildAuth(): Promise<AuthInstance> {
  let runtime
  try {
    runtime = await getEffectiveRuntime()
  } catch {
    runtime = null
  }

  const cors =
    runtime?.corsOrigins ??
    env.CORS_ORIGINS
  const origins =
    cors === '*'
      ? ['*']
      : cors.split(',').map((o: string) => o.trim()).filter(Boolean)

  const publicUrl = runtime?.publicUrl || env.BETTER_AUTH_URL
  const socialProviders = runtime
    ? buildSocialProviders(runtime)
    : undefined

  const emailEnabled = Boolean(runtime?.email.enabled)
  const requireVerification = Boolean(runtime?.requireEmailVerification)

  const instance = betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: 'sqlite',
      schema,
    }),
    baseURL: publicUrl,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: requireVerification,
      sendResetPassword: async ({ user, url }) => {
        if (!runtime) return
        const msg = renderResetPasswordEmail({
          user,
          url,
          brandName: runtime.email.brandName || runtime.appName,
          brandColor: runtime.email.brandColor,
        })
        void sendAuthEmail(runtime, msg)
      },
    },
    emailVerification: emailEnabled
      ? {
          sendOnSignUp: true,
          sendVerificationEmail: async ({ user, url }) => {
            if (!runtime) return
            const msg = renderVerificationEmail({
              user,
              url,
              brandName: runtime.email.brandName || runtime.appName,
              brandColor: runtime.email.brandColor,
            })
            void sendAuthEmail(runtime, msg)
          },
        }
      : undefined,
    socialProviders,
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'user',
          input: false,
          required: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string; email: string }) => {
            await promoteIfNeeded(user.id, user.email)
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: publicUrl.startsWith('https://'),
      defaultCookieAttributes: {
        sameSite: 'lax',
      },
    },
    trustedOrigins: origins,
  }) as unknown as AuthInstance

  return instance
}

export function getAuth(): AuthInstance {
  if (authInstance) return authInstance
  // Sync fallback: build without awaiting runtime (env-only) for first call
  // Prefer rebuildAuth() after settings init.
  if (!authInstance) {
    // Fire sync build with env defaults — runtime may enrich on rebuild
    const cors = env.CORS_ORIGINS
    const origins =
      cors === '*'
        ? ['*']
        : cors.split(',').map((o: string) => o.trim()).filter(Boolean)

    authInstance = betterAuth({
      database: drizzleAdapter(getDb(), {
        provider: 'sqlite',
        schema,
      }),
      baseURL: env.BETTER_AUTH_URL,
      secret: env.BETTER_AUTH_SECRET,
      emailAndPassword: {
        enabled: true,
      },
      user: {
        additionalFields: {
          role: {
            type: 'string',
            defaultValue: 'user',
            input: false,
            required: false,
          },
        },
      },
      databaseHooks: {
        user: {
          create: {
            after: async (user: { id: string; email: string }) => {
              await promoteIfNeeded(user.id, user.email)
            },
          },
        },
      },
      session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24,
      },
      advanced: {
        useSecureCookies: env.BETTER_AUTH_URL.startsWith('https://'),
        defaultCookieAttributes: {
          sameSite: 'lax',
        },
      },
      trustedOrigins: origins,
    }) as unknown as AuthInstance
  }
  return authInstance
}

/** Rebuild auth singleton after settings / OAuth / email changes */
export async function rebuildAuth(): Promise<void> {
  if (building) {
    await building
  }
  building = buildAuth().then((inst) => {
    authInstance = inst
    building = null
    return inst
  })
  await building
}

/**
 * Promote first registered user to admin, or any email listed in adminEmails setting / ADMIN_EMAILS.
 * Uses an atomic UPDATE … WHERE no admins exist to avoid races.
 */
async function promoteIfNeeded(userId: string, email: string): Promise<void> {
  const client = getClient()
  let adminEmails: string[] = []
  try {
    const runtime = await getEffectiveRuntime()
    adminEmails = (runtime.adminEmails || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  } catch {
    adminEmails = (env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  }

  const emailLower = email.toLowerCase()
  if (adminEmails.includes(emailLower)) {
    await client.execute({
      sql: `UPDATE "user" SET "role" = 'admin', "updatedAt" = ? WHERE "id" = ?`,
      args: [Date.now(), userId],
    })
    return
  }

  // Atomic: only promote if there are still zero admins
  await client.execute({
    sql: `UPDATE "user"
          SET "role" = 'admin', "updatedAt" = ?
          WHERE "id" = ?
            AND (SELECT COUNT(*) FROM "user" WHERE "role" = 'admin') = 0`,
    args: [Date.now(), userId],
  })
}

export async function setUserRole(
  userId: string,
  role: 'admin' | 'user',
): Promise<boolean> {
  const client = getClient()

  if (role === 'user') {
    const admins = await client.execute(
      `SELECT COUNT(*) as total FROM "user" WHERE "role" = 'admin'`,
    )
    const adminCount = Number(admins.rows[0]?.total || 0)
    const target = await client.execute({
      sql: `SELECT "role" FROM "user" WHERE "id" = ? LIMIT 1`,
      args: [userId],
    })
    const currentRole = String(target.rows?.[0]?.role || '')
    if (currentRole === 'admin' && adminCount <= 1) {
      throw Object.assign(new Error('Cannot demote the last admin'), {
        status: 400,
        code: 'LAST_ADMIN',
      })
    }
  }

  const result = await client.execute({
    sql: `UPDATE "user" SET "role" = ?, "updatedAt" = ? WHERE "id" = ?`,
    args: [role, Date.now(), userId],
  })
  return (result.rowsAffected || 0) > 0
}

export function resetAuthForTests(): void {
  authInstance = null
  building = null
}

/** Lazy proxy so existing `auth.api` / `auth.handler` call sites keep working */
export const auth = new Proxy({} as AuthInstance, {
  get(_target, prop, receiver) {
    const instance = getAuth()
    const value = Reflect.get(instance as object, prop, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
