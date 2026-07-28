import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '../db/client.js'
import { schema } from '../db/schema.js'
import env from '../env.js'

const origins = env.CORS_ORIGINS === '*'
  ? ['*']
  : env.CORS_ORIGINS.split(',').map((o: string) => o.trim())

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema,
  }),
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,     // refresh session once per day
  },
  advanced: {
    useSecureCookies: env.BETTER_AUTH_URL.startsWith('https://'),
    defaultCookieAttributes: {
      sameSite: 'lax',
    },
  },
  trustedOrigins: origins,
})
