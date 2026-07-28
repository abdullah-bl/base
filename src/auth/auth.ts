import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { getDb, getClient } from '../db/client.js'
import { schema } from '../db/schema.js'
import env, { parseAdminEmails } from '../env.js'

type AuthInstance = ReturnType<typeof betterAuth>

let authInstance: AuthInstance | null = null

export function getAuth(): AuthInstance {
  if (!authInstance) {
    const origins =
      env.CORS_ORIGINS === '*'
        ? ['*']
        : env.CORS_ORIGINS.split(',').map((o: string) => o.trim())

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

/**
 * Promote first registered user to admin, or any email listed in ADMIN_EMAILS.
 */
async function promoteIfNeeded(userId: string, email: string): Promise<void> {
  const client = getClient()
  const adminEmails = parseAdminEmails()
  const emailLower = email.toLowerCase()

  let shouldPromote = adminEmails.includes(emailLower)

  if (!shouldPromote) {
    const count = await client.execute(
      `SELECT COUNT(*) as total FROM "user" WHERE "role" = 'admin'`,
    )
    const adminCount = Number(count.rows[0]?.total || 0)
    if (adminCount === 0) {
      // First user (or first after wipe) becomes admin
      const totalUsers = await client.execute(
        `SELECT COUNT(*) as total FROM "user"`,
      )
      // After create, this user already exists — promote if they are the only one
      // or if there are zero admins and this is the first signup wave
      if (Number(totalUsers.rows[0]?.total || 0) <= 1) {
        shouldPromote = true
      } else if (adminCount === 0) {
        shouldPromote = true
      }
    }
  }

  if (shouldPromote) {
    await client.execute({
      sql: `UPDATE "user" SET "role" = 'admin', "updatedAt" = ? WHERE "id" = ?`,
      args: [Date.now(), userId],
    })
  }
}

export async function setUserRole(
  userId: string,
  role: 'admin' | 'user',
): Promise<boolean> {
  const client = getClient()
  const result = await client.execute({
    sql: `UPDATE "user" SET "role" = ?, "updatedAt" = ? WHERE "id" = ?`,
    args: [role, Date.now(), userId],
  })
  return (result.rowsAffected || 0) > 0
}

export function resetAuthForTests(): void {
  authInstance = null
}

/** Lazy proxy so existing `auth.api` / `auth.handler` call sites keep working */
export const auth = new Proxy({} as AuthInstance, {
  get(_target, prop, receiver) {
    const instance = getAuth()
    const value = Reflect.get(instance as object, prop, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
