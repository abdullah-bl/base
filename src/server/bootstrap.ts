import env from '../env.js'
import { initDb } from '../db/client.js'
import { autoMigrate } from '../db/migrate.js'
import { applyEvolution, formatPlan } from '../schema/evolve.js'
import { getRegisteredCollections } from '../schema/registry.js'
import {
  importRegistryToDbIfEmpty,
  loadRegistryFromDb,
} from '../schema/collection-store.js'
import { startBackupSchedule } from '../backup/index.js'
import { initLogBus } from '../observability/bus.js'
import { logger } from '../observability/logger.js'
import { initSettings, getEffectiveRuntime } from '../settings/resolve.js'
import { rebuildAuth } from '../auth/auth.js'
import { ensureSetupToken } from '../auth/onboarding.js'
import {
  finalizeRestartAfterBoot,
  setActiveServer,
} from './restart.js'
import { resetDynamicRouterCache } from '../collections/dynamic-router.js'
import { VERSION } from '../version.js'

export interface BootstrapOptions {
  /** Load/register collections before the app is created (legacy collections.ts) */
  loadCollections?: () => void | Promise<void>
  /** Skip starting Bun.serve (for CLI ops that only need DB) */
  serve?: boolean
  port?: number
}

export interface BootstrapResult {
  app?: import('hono').Hono
  server?: ReturnType<typeof Bun.serve>
  stop: () => void
}

/**
 * Shared boot sequence for server + CLI.
 * Collection loading is injectable so compiled binaries can embed or
 * dynamically import a collections module. After boot, DB-backed schema
 * becomes the source of truth (legacy file is imported once if DB empty).
 */
export async function bootstrap(
  opts: BootstrapOptions = {},
): Promise<BootstrapResult> {
  initLogBus()

  if (opts.loadCollections) {
    await opts.loadCollections()
  }

  await initDb()
  await autoMigrate()
  await initSettings()

  // Migrate in-memory/file collections → DB if store empty
  const imported = await importRegistryToDbIfEmpty('boot-import')
  if (imported > 0) {
    console.log(`📥 Imported ${imported} collection(s) into DB schema store`)
  }

  // Prefer DB as source of truth
  try {
    await loadRegistryFromDb()
    resetDynamicRouterCache()
  } catch (err) {
    console.warn(
      '⚠️  Could not load collections from DB — using in-memory registry',
      err instanceof Error ? err.message : err,
    )
  }

  await rebuildAuth()

  const collections = getRegisteredCollections().filter(
    (c) => c.name !== 'user' && c.name !== 'users',
  )

  const plan = await applyEvolution(collections)
  if (plan.ops.length > 0) {
    console.log(formatPlan(plan))
  }

  // Issue setup token on first boot when needed
  try {
    const token = await ensureSetupToken()
    if (token) {
      console.log('\n🔐 First-run setup token (save this — shown once):')
      console.log(`   ${token}`)
      console.log('   Complete setup at Admin UI → /_/setup\n')
    }
  } catch {
    // ignore
  }

  await finalizeRestartAfterBoot()

  const serve = opts.serve !== false
  if (!serve) {
    return {
      stop: () => {
        // no-op
      },
    }
  }

  const { createApp } = await import('./hono-app.js')
  const app = createApp()
  const PORT = opts.port ?? env.PORT

  startBackupSchedule()

  const server = Bun.serve({
    fetch: app.fetch,
    port: PORT,
    // Bun default idleTimeout is 10s — too short for SSE heartbeats (15s).
    idleTimeout: 255,
  })
  setActiveServer(server)

  let runtimeName = 'Base'
  try {
    const rt = await getEffectiveRuntime()
    runtimeName = rt.appName || runtimeName
  } catch {
    // ignore
  }

  logger.info('boot', `${runtimeName} BaaS Server started`, {
    meta: {
      port: server.port,
      database: env.DATABASE_URL,
      storage: env.STORAGE_DRIVER,
      admin: env.ADMIN_ENABLED ? env.ADMIN_PATH : false,
      supervised: process.env.BASE_SUPERVISED === '1',
    },
  })

  console.log(`🚀 ${runtimeName} BaaS Server started`)
  console.log(`   Port: ${server.port}`)
  console.log(`   Database: ${env.DATABASE_URL}`)
  console.log(`   Storage: ${env.STORAGE_DRIVER}`)
  console.log(`   Version: ${VERSION}`)
  if (env.ADMIN_ENABLED) {
    console.log(`   Admin UI: http://localhost:${PORT}${env.ADMIN_PATH}/`)
  }
  console.log('')
  console.log(`Health check: http://localhost:${PORT}/api/health`)
  console.log(`OpenAPI: http://localhost:${PORT}/api/openapi.json`)
  console.log(`Auth: http://localhost:${PORT}/api/auth/sign-up/email`)
  console.log(`Realtime: http://localhost:${PORT}/api/realtime`)

  const stop = () => {
    void import('../realtime/bus.js').then(({ closeAllForShutdown }) => {
      closeAllForShutdown()
    })
    void import('../backup/index.js').then(({ stopBackupSchedule }) => {
      stopBackupSchedule()
    })
    setActiveServer(null)
    server.stop()
  }

  const shutdown = (signal: string) => {
    console.log(`\n📴 Received ${signal}, shutting down gracefully...`)
    stop()
    console.log('✅ Server closed successfully')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  return { app, server, stop }
}
