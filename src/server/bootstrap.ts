import env from '../env.js'
import { initDb } from '../db/client.js'
import { autoMigrate } from '../db/migrate.js'
import { applyEvolution, formatPlan } from '../schema/evolve.js'
import { getRegisteredCollections } from '../schema/registry.js'
import { startBackupSchedule } from '../backup/index.js'
import { initLogBus } from '../observability/bus.js'
import { logger } from '../observability/logger.js'

export interface BootstrapOptions {
  /** Load/register collections before the app is created */
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
 * dynamically import a collections module.
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

  const collections = getRegisteredCollections().filter(
    (c) => c.name !== 'user' && c.name !== 'users',
  )

  const plan = await applyEvolution(collections)
  if (plan.ops.length > 0) {
    console.log(formatPlan(plan))
  }

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

  logger.info('boot', 'Base BaaS Server started', {
    meta: {
      port: server.port,
      database: env.DATABASE_URL,
      storage: env.STORAGE_DRIVER,
      admin: env.ADMIN_ENABLED ? env.ADMIN_PATH : false,
    },
  })

  console.log('🚀 Base BaaS Server started')
  console.log(`   Port: ${server.port}`)
  console.log(`   Database: ${env.DATABASE_URL}`)
  console.log(`   Storage: ${env.STORAGE_DRIVER}`)
  console.log(`   Version: 0.1.0`)
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
