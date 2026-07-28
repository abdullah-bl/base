import env from './env.js'
import { initDb } from './db/client.js'
import { autoMigrate } from './db/migrate.js'
import { applyEvolution, formatPlan } from './schema/evolve.js'
import { getRegisteredCollections } from './schema/registry.js'

// Import collections FIRST — registers them before the Hono app loads
import '../collections.js'

async function main() {
  await initDb()
  await autoMigrate()

  const collections = getRegisteredCollections().filter(
    (c) => c.name !== 'user' && c.name !== 'users',
  )

  // Apply additive schema evolution (blocked changes throw)
  const plan = await applyEvolution(collections)
  if (plan.ops.length > 0) {
    console.log(formatPlan(plan))
  }

  // Import app after DB is ready (auth adapter needs tables)
  const { createApp } = await import('./server/hono-app.js')
  const app = createApp()

  const PORT = env.PORT

  const server = Bun.serve({
    fetch: app.fetch,
    port: PORT,
    // Bun default idleTimeout is 10s — too short for SSE heartbeats (15s).
    // 255 is Bun's maximum idleTimeout value.
    idleTimeout: 255,
  })

  console.log('🚀 Base BaaS Server started')
  console.log(`   Port: ${server.port}`)
  console.log(`   Database: ${env.DATABASE_URL}`)
  console.log(`   Storage: ${env.STORAGE_DRIVER}`)
  console.log(`   Version: 0.1.0`)
  console.log('')
  console.log(`Health check: http://localhost:${PORT}/api/health`)
  console.log(`Auth: http://localhost:${PORT}/api/auth/sign-up/email`)
  console.log(`Realtime: http://localhost:${PORT}/api/realtime`)

  const shutdown = (signal: string) => {
    console.log(`\n📴 Received ${signal}, shutting down gracefully...`)
    void import('./realtime/bus.js').then(({ closeAllForShutdown }) => {
      closeAllForShutdown()
    })
    server.stop()
    console.log('✅ Server closed successfully')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err)
  process.exit(1)
})
