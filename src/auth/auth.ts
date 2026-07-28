import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { getDb } from '../db/client.js'
import { schema } from '../db/schema.js'
import env from '../env.js'

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
    }) as AuthInstance
  }
  return authInstance
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
