import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@libsql/client'

export interface TestContext {
  dir: string
  app: import('hono').Hono
  baseUrl: string
  cleanup: () => void
}

/**
 * Build an isolated app + temp DB + storage for integration tests.
 * Must be called before using production singletons from a previous test.
 */
export async function createTestContext(options?: {
  collections?: () => void | Promise<void>
  env?: Record<string, string>
}): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'base-test-'))
  const dbPath = join(dir, 'test.db')
  const storagePath = join(dir, 'uploads')

  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = `file:${dbPath}`
  process.env.STORAGE_PATH = storagePath
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-32-characters-long'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.CORS_ORIGINS = 'http://localhost:3000'
  process.env.HARD_DELETE_ENABLED = 'false'
  process.env.STORAGE_DRIVER = 'local'
  process.env.REALTIME_ENABLED = 'true'
  process.env.ADMIN_ENABLED = 'true'
  process.env.ADMIN_TOKEN =
    'test-admin-token-at-least-32-characters-long'
  process.env.LOG_PERSIST = 'true'
  process.env.RATE_LIMIT_ENABLED = 'false'
  process.env.WEBHOOKS_ENABLED = 'false'
  process.env.BACKUP_DIR = resolve(dir, 'backups')
  delete process.env.DATABASE_AUTH_TOKEN
  delete process.env.S3_BUCKET
  delete process.env.S3_ACCESS_KEY_ID
  delete process.env.S3_SECRET_ACCESS_KEY
  delete process.env.ADMIN_EMAILS

  if (options?.env) {
    for (const [k, v] of Object.entries(options.env)) {
      process.env[k] = v
    }
  }

  // Dynamic imports after env is set — reset singletons
  const { resetEnvForTests, loadEnv } = await import('../../src/env.js')
  resetEnvForTests()
  loadEnv(true)

  const {
    resetClientForTests,
    setClientForTests,
    initDb,
  } = await import('../../src/db/client.js')
  resetClientForTests()

  const client = createClient({ url: `file:${dbPath}` })
  setClientForTests(client)
  await initDb()

  const { resetAuthForTests } = await import('../../src/auth/auth.js')
  resetAuthForTests()

  const { clearRegistry } = await import('../../src/schema/registry.js')
  clearRegistry()

  const { resetEnsuredTables } = await import(
    '../../src/collections/table-create.js'
  )
  resetEnsuredTables()

  const { resetFilesTableCache } = await import('../../src/files/meta.js')
  resetFilesTableCache()

  const { resetStorageDriverForTests } = await import(
    '../../src/files/storage.js'
  )
  resetStorageDriverForTests()

  const { resetBusForTests } = await import('../../src/realtime/bus.js')
  resetBusForTests()

  const { resetLogBusForTests } = await import('../../src/observability/bus.js')
  resetLogBusForTests()

  const { resetRateLimitForTests } = await import(
    '../../src/server/rate-limit.js'
  )
  resetRateLimitForTests()

  const { setMaintenanceMode } = await import(
    '../../src/server/maintenance.js'
  )
  setMaintenanceMode(false)

  const { resetDefaultAppForTests, createApp } = await import(
    '../../src/server/hono-app.js'
  )
  resetDefaultAppForTests()

  const { autoMigrate } = await import('../../src/db/migrate.js')
  await autoMigrate()

  if (options?.collections) {
    await options.collections()
  } else {
    const { defineCollection, f } = await import('../../src/schema/define.js')
    defineCollection('posts', {
      fields: {
        title: f.string().required().max(200),
        content: f.text().optional(),
        slug: f.string().unique(),
        published: f.boolean().default(false),
        viewCount: f.integer().default(0),
        authorId: f.reference('user').required(),
        meta: f.json().optional(),
        embedding: f.vector(3).optional(),
      },
      indexes: [
        { fields: ['authorId', 'createdAt'], name: 'idx_posts_author' },
        { fields: ['slug'], unique: true },
      ],
      access: {
        create: 'owner',
        read: 'owner',
        update: 'owner',
        delete: 'owner',
        ownerField: 'authorId',
      },
    })
  }

  const { applyEvolution } = await import('../../src/schema/evolve.js')
  const { getRegisteredCollections } = await import(
    '../../src/schema/registry.js'
  )
  await applyEvolution(
    getRegisteredCollections().filter(
      (c) => c.name !== 'user' && c.name !== 'users',
    ),
  )

  const app = createApp()

  return {
    dir,
    app,
    baseUrl: 'http://localhost:3000',
    cleanup: () => {
      try {
        client.close()
      } catch {
        // ignore
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    },
  }
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T
}

export function extractCookies(res: Response): string {
  const anyHeaders = res.headers as Headers & {
    getSetCookie?: () => string[]
  }
  const setCookies =
    anyHeaders.getSetCookie?.() ||
    (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
  return setCookies
    .filter(Boolean)
    .map((c) => c.split(';')[0])
    .join('; ')
}

export async function signUpAndIn(
  app: import('hono').Hono,
  email: string,
  password = 'password123',
  name = 'Test User',
): Promise<{ cookie: string; userId?: string }> {
  await app.request('http://localhost:3000/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  })

  const signIn = await app.request(
    'http://localhost:3000/api/auth/sign-in/email',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
  )

  const cookie = extractCookies(signIn)
  const me = await app.request('http://localhost:3000/api/auth/me', {
    headers: { Cookie: cookie },
  })
  const meBody = (await me.json()) as { user?: { id: string } }
  return { cookie, userId: meBody.user?.id }
}
